import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { DateTime } from "luxon";
import { config, scopes } from "../functions/src/connect/oauth.ts";
import { prioritize } from "../functions/src/connect/reads.ts";
import { toolsFor } from "../functions/src/connect/server.ts";
import { createApp } from "../functions/src/http.ts";
import {
  connectPlatformForHost,
  connectPlatformsForRedirects,
} from "../packages/shared/src/connect-platforms.ts";

const settings = {
  origin: "https://example.invalid",
  resource: new URL("https://example.invalid/api/mcp"),
  writes: true,
  clients: [],
  redirects: [],
  geminiRegistry: false,
  geminiPersistentRefresh: false,
};
async function discover(writes = true) {
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  const server = toolsFor(
    { uid: "test", clientId: "test", grantId: "test", scopes: [...scopes] },
    { ...settings, writes },
  );
  const client = new Client({ name: "schema-tests", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}
describe("MCP schema and ranking contracts", () => {
  it("validates each tool and rejects unexpected user identity or arguments", async () => {
    const client = await discover();
    try {
      const { tools } = await client.listTools();
      const invalid: Record<string, Record<string, unknown>> = {
        list_topics: { limit: 51 },
        get_topic: { topicId: "bad/path" },
        get_due_reviews: { window: "last centennial" },
        preview_review: { duration: 4 },
        get_review_history: { start: "2026-02-30" },
        get_topic_history: { limit: 0 },
        get_learning_stats: { groupBy: "hour" },
        get_weak_topics: { limit: 21 },
        get_learning_profile: { includeCredentials: true },
        create_topic: { title: "", initialKnowledge: 0 },
        complete_review: { reviewId: "review", rating: 9 },
        reschedule_review: {
          reviewId: "review",
          scheduledAt: "2027-01-01T12:00",
        },
      };
      expect(tools.map((t) => t.name).sort()).toEqual(
        Object.keys(invalid).sort(),
      );
      for (const tool of tools) {
        expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
        expect(tool.outputSchema, tool.name).toBeTruthy();
        const response = await client.callTool({
          name: tool.name,
          arguments: { ...invalid[tool.name], uid: "bob" },
        });
        expect(response.isError, tool.name).toBe(true);
      }
    } finally {
      await client.close();
    }
  });
  it("defaults off and publishes nine read tools when the write flag is off", async () => {
    vi.stubEnv("BLIND_SPOT_CONNECT_ENABLED", undefined);
    try {
      expect(config()).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
    const client = await discover(false);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(9);
      expect(tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
    } finally {
      await client.close();
    }
  });
  it("disables Connect without taking down the existing API if enabled configuration is invalid", async () => {
    vi.stubEnv("BLIND_SPOT_CONNECT_ENABLED", "true");
    vi.stubEnv("BLIND_SPOT_CONNECT_ORIGIN", "invalid-origin");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = createApp().listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Expected a loopback HTTP server");
      const origin = "http://127.0.0.1:" + address.port;
      expect((await fetch(origin + "/api/mcp")).status).toBe(404);
      expect((await fetch(origin + "/api/v1/me")).status).toBe(401);
      expect(report).toHaveBeenCalledOnce();
    } finally {
      server.close();
      report.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("allows a fixed native loopback callback and rejects other HTTP callbacks in production", () => {
    vi.stubEnv("BLIND_SPOT_CONNECT_ENABLED", "true");
    vi.stubEnv("BLIND_SPOT_CONNECT_ORIGIN", "https://example.invalid");
    const provision = (uri: string) =>
      vi.stubEnv(
        "BLIND_SPOT_CONNECT_CLIENTS",
        JSON.stringify([
          {
            client_id: "native",
            client_name: "Native app",
            redirect_uris: [uri],
          },
        ]),
      );
    try {
      provision("http://localhost:6274/oauth/callback");
      expect(config()?.clients[0].redirect_uris).toEqual([
        "http://localhost:6274/oauth/callback",
      ]);
      provision("http://external.invalid:6274/oauth/callback");
      expect(config).toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("ranks recorded low ratings and separates overdue unreviewed topics", () => {
    const now = DateTime.fromISO("2026-03-30T13:00:00+05:00");
    const topic = { id: "topic", title: "Example", importance: 4 };
    const scheduled = {
      id: "review",
      scheduled_at: "2026-03-29T08:00:00.000Z",
      duration: 15,
      topic_id: "topic",
      status: "pending",
    };
    expect(prioritize(topic, [], scheduled, now)).toMatchObject({
      latestRating: null,
      priority: 2,
      knowledgeReasons: [],
      schedulingReasons: ["review_overdue"],
    });
    const recent = [2, 1, 5].map((original_rating) => ({
      original_rating,
      completed_at: "2026-03-25T08:00:00Z",
    }));
    expect(prioritize(topic, recent, scheduled, now)).toMatchObject({
      latestRating: 2,
      priority: 12,
      dataSufficiency: "three_or_more",
      knowledgeReasons: [
        "latest_rating_at_most_2",
        "at_least_two_low_ratings_in_last_five",
        "rating_declined_by_two_or_more",
      ],
    });
  });
});

it("identifies assistant setup from configured callback URLs and grants from their callback domains", () => {
  expect(connectPlatformsForRedirects([])).toEqual({
    chatgpt: false,
    claude: false,
    gemini: false,
    other: false,
  });
  expect(
    connectPlatformsForRedirects([
      "https://chatgpt.com/connector/oauth/sample",
      "https://claude.ai/api/mcp/auth_callback",
      "https://oauth-redirect-sandbox.googleusercontent.com/r/sample",
      "http://localhost:6274/oauth/callback",
    ]),
  ).toEqual({ chatgpt: true, claude: true, gemini: true, other: true });
  expect(
    connectPlatformsForRedirects(["https://claude.ai/settings/connectors"])
      .claude,
  ).toBe(false);
  expect(connectPlatformForHost("chatgpt.com.example.invalid")).toBe("other");
  expect(
    connectPlatformForHost("oauth-redirect-test.googleusercontent.com"),
  ).toBe("gemini");
});
