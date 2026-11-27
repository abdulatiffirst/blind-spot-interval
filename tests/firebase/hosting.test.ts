import { createHash } from "node:crypto";
import { expect, it } from "vitest";

const origin = "http://localhost:5000";
const production = "https://blind-spot-interval.web.app";
const pages = ["/", "/privacy", "/terms", "/support"];

it.skipIf(process.env.BLIND_SPOT_CONNECT_ENABLED !== "true")(
  "serves static crawler files and preserves SPA and API rewrites",
  async () => {
    const robots = await fetch(origin + "/robots.txt");
    expect(robots.status).toBe(200);
    expect(robots.headers.get("content-type")).toMatch(/^text\/plain\b/);
    const directives = await robots.text();
    expect(directives).toMatch(/^User-agent: \*$/m);
    expect(directives).toContain("Disallow: /api/");
    expect(directives).toContain("Disallow: /*?");
    expect(directives).toContain("Sitemap: " + production + "/sitemap.xml");
    expect(directives).not.toMatch(/<!doctype html/i);

    const sitemap = await fetch(origin + "/sitemap.xml");
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get("content-type")).toMatch(
      /^(application|text)\/xml\b/,
    );
    const xml = await sitemap.text();
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml).toMatch(/<\/urlset>\s*$/);
    expect(
      [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]),
    ).toEqual(pages.map((path) => production + path));
    expect(xml).not.toMatch(/<!doctype html/i);

    for (const path of [...pages, "/?section=Settings", "/connect/authorize"]) {
      const page = await fetch(origin + path);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toMatch(/^text\/html\b/);
      expect(page.headers.get("x-frame-options")).toBe("DENY");
      expect(page.headers.get("permissions-policy")).toContain("camera=()");
      const html = await page.text();
      expect(html).toContain('<div id="root"></div>');
      const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)![1];
      const hash = createHash("sha256").update(inlineScript).digest("base64");
      expect(page.headers.get("content-security-policy-report-only")).toContain(
        "'sha256-" + hash + "'",
      );
    }
    expect((await fetch(origin + "/api/v1/me")).status).toBe(401);
  },
);
