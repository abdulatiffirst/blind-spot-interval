import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Cable,
  ExternalLink,
  ChevronDown,
  Copy,
  MessageCircle,
  Sparkles,
  Sun,
} from "lucide-react";
import type { User } from "firebase/auth";
import {
  connectPlatformForHost,
  connectPlatforms,
  type ConnectApprovalMode,
  type ConnectPlatform,
} from "../../../packages/shared/src/connect-platforms.ts";
import { api } from "./api";
import { connectListings } from "./connect-listings";
import { Button, Dialog } from "./ui";
import { translate, useLanguage, type Language, type MessageKey } from "./i18n";
import {
  ConnectLoading,
  ConnectNotice,
  scopeLabels,
  type ConnectScope,
} from "./connect-ui";

const assistants = {
  chatgpt: {
    name: "ChatGPT",
    icon: MessageCircle,
    home: "https://chatgpt.com/",
    requirement: "connectChatgptRequirement",
    steps: ["connectChatgptStep1", "connectChatgptStep2"],
    docs: "https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt",
  },
  claude: {
    name: "Claude",
    icon: Sun,
    home: "https://claude.ai/",
    requirement: "connectClaudeRequirement",
    steps: ["connectClaudeStep1", "connectClaudeStep2"],
    docs: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
  },
  gemini: {
    name: "Gemini",
    icon: Sparkles,
    home: "https://gemini.google.com/",
    requirement: "connectGeminiRequirement",
    steps: ["connectGeminiStep1", "connectGeminiStep2"],
    docs: "https://support.google.com/gemini/answer/17209137",
  },
  other: {
    name: "",
    icon: Bot,
    home: undefined,
    requirement: "connectOtherRequirement",
    steps: ["connectOtherStep1", "connectOtherStep2", "connectOtherStep3"],
    docs: undefined,
  },
} satisfies Record<
  ConnectPlatform,
  {
    name: string;
    icon: typeof Bot;
    home?: string;
    requirement: MessageKey;
    steps: MessageKey[];
    docs?: string;
  }
>;

type Application = {
  clientId: string;
  grantId?: string;
  approvalMode?: ConnectApprovalMode;
  name: string;
  host: string;
  scopes: ConnectScope[];
  connectedAt: string;
};
type Settings = {
  enabled: boolean;
  resource: string | null;
  writes: boolean;
  platforms: Record<ConnectPlatform, boolean>;
  applications: Application[];
  expiredPlatforms?: ConnectPlatform[];
};
type RevokeTarget = { application: Application | null };

function platformName(platform: ConnectPlatform) {
  return assistants[platform].name || translate("connectOther");
}

function accessLabel(
  app: Application,
  { enabled, writes }: Settings,
): MessageKey {
  const read = app.scopes.some((scope) => scope.endsWith(":read"));
  const write = writes && app.scopes.some((scope) => scope.endsWith(":write"));
  if (!enabled || (!read && !write)) return "connectPaused";
  if (write) return read ? "connectWriteAccess" : "connectChangesAccess";
  return "connectReadAccess";
}

function Badge({
  label,
  active = false,
}: {
  label: MessageKey;
  active?: boolean;
}) {
  return (
    <span className={"connect-badge" + (active ? " active" : "")}>
      {translate(label)}
    </span>
  );
}

function CopyField({
  value,
  label,
  copyLabel,
  copiedLabel,
  failedLabel,
  assistantUrl,
}: {
  value: string;
  label: MessageKey;
  copyLabel: MessageKey;
  copiedLabel: MessageKey;
  failedLabel: MessageKey;
  assistantUrl?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<"copied" | "failed">();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setResult("copied");
    } catch {
      input.current?.focus();
      input.current?.select();
      setResult("failed");
    }
  }
  return (
    <div className="connect-address">
      <label>
        <span>{translate(label)}</span>
        <input
          ref={input}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <Button type="button" onClick={() => void copy()}>
        <Copy size={16} aria-hidden="true" />
        {translate(copyLabel)}
      </Button>
      {assistantUrl && (
        <a
          className="button primary connect-open-assistant"
          href={assistantUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => void copy()}
        >
          {translate("connectCopyAndOpen")}
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      )}
      {result && (
        <p role="status">
          {translate(result === "copied" ? copiedLabel : failedLabel)}
        </p>
      )}
    </div>
  );
}

function ConnectionAddress({
  resource,
  assistantUrl,
}: {
  resource: string;
  assistantUrl?: string;
}) {
  return (
    <CopyField
      value={resource}
      label="connectUrl"
      copyLabel="connectCopy"
      copiedLabel="connectCopied"
      failedLabel="connectCopyError"
      assistantUrl={assistantUrl}
    />
  );
}

function ExamplePrompt({ applications }: { applications: Application[] }) {
  const prompt = applications.some(({ scopes }) =>
    scopes.includes("reviews:read"),
  )
    ? "connectExampleReviews"
    : applications.some(({ scopes }) => scopes.includes("topics:read"))
      ? "connectExampleTopics"
      : "connectExamplePermissions";
  return (
    <CopyField
      value={translate(prompt)}
      label="connectExample"
      copyLabel="connectCopyPrompt"
      copiedLabel="connectPromptCopied"
      failedLabel="connectPromptCopyError"
    />
  );
}

function SetupDialog({
  platform,
  resource,
  onClose,
  applications,
  replacing,
}: {
  platform: ConnectPlatform;
  resource: string | null;
  onClose: () => void;
  applications: Application[];
  replacing: boolean;
}) {
  const connected = applications.length > 0;
  const item = assistants[platform];
  const name = platformName(platform);
  return (
    <Dialog
      title={translate(
        connected
          ? "connectConnectedTitle"
          : resource
            ? replacing
              ? "connectReplaceTitle"
              : "connectSetupTitle"
            : "connectRequirementsTitle",
        { platform: name },
      )}
      description={translate(
        connected
          ? "connectConnectedDescription"
          : resource
            ? replacing
              ? "connectReplaceSetup"
              : "connectSetupDescription"
            : "connectUnavailableDetail",
        { platform: name },
      )}
      onClose={onClose}
    >
      <div className="connect-dialog-body">
        {connected ? (
          <ExamplePrompt applications={applications} />
        ) : (
          <p>{translate(item.requirement)}</p>
        )}
        {!connected && resource && (
          <>
            <ol className="connect-steps">
              {item.steps.map((step) => (
                <li key={step}>{translate(step)}</li>
              ))}
            </ol>
            <ConnectionAddress resource={resource} assistantUrl={item.home} />
            {platform === "gemini" && (
              <p>{translate("connectGeminiTroubleshooting")}</p>
            )}
          </>
        )}
        {!connected && item.docs && (
          <a
            className="button connect-docs"
            href={item.docs}
            target="_blank"
            rel="noreferrer"
          >
            {translate("connectProviderDocs")}{" "}
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        )}
      </div>
    </Dialog>
  );
}

function ConnectionDetails({
  application,
  data,
  locale,
  onRevoke,
  onApprovalChange,
  busy,
}: {
  application: Application;
  data: Settings;
  locale: Language;
  busy: boolean;
  onRevoke: () => void;
  onApprovalChange: (mode: ConnectApprovalMode) => void;
}) {
  const { name, host, scopes, connectedAt } = application;
  const time = new Date(connectedAt);
  const date = Number.isFinite(time.getTime())
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(time)
    : null;
  const access = accessLabel(application, data);
  const approvalMode = application.approvalMode ?? "ask";
  const canAllow =
    data.enabled &&
    data.writes &&
    scopes.some((scope) => scope.endsWith(":write"));
  return (
    <details className="connect-application">
      <summary className="connect-app-summary">
        <span>{name}</span>
        <Badge label={access} active={access !== "connectPaused"} />
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="connect-grant-body">
        <div className="connect-app-identity">
          <p>{host}</p>
          {date && (
            <p>
              <time dateTime={connectedAt}>
                {translate("connectConnectedOn", { date })}
              </time>
            </p>
          )}
        </div>
        <div className="connect-granted">
          <strong>{translate("connectPermissions")}</strong>
          <ul>
            {scopes.map((scope) => (
              <li key={scope}>{translate(scopeLabels[scope])}</li>
            ))}
          </ul>
        </div>
        <div className="connect-approval">
          <label>
            <strong>{translate("connectApprovalLabel")}</strong>
            <select
              value={approvalMode}
              disabled={
                busy ||
                !application.grantId ||
                (!canAllow && approvalMode === "ask")
              }
              onChange={(event) =>
                onApprovalChange(
                  event.target.value === "allow" ? "allow" : "ask",
                )
              }
            >
              <option value="ask">{translate("connectApprovalAsk")}</option>
              <option value="allow" disabled={!canAllow}>
                {translate("connectApprovalAllow")}
              </option>
            </select>
          </label>
          {!canAllow && <p>{translate("connectApprovalUnavailable")}</p>}
        </div>
        <Button type="button" disabled={busy} onClick={onRevoke}>
          {translate("connectRevoke")}
        </Button>
      </div>
    </details>
  );
}

export function ConnectSettings({
  accountId,
  identity,
}: {
  accountId: string;
  identity?: User;
}) {
  const locale = useLanguage();
  const cache = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const [setup, setSetup] = useState<{
    platform: ConnectPlatform;
    previous?: string[];
  }>();
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget>();
  const [approvalTarget, setApprovalTarget] = useState<Application>();
  const [revoked, setRevoked] = useState(false);
  const queryKey = ["account", accountId, "connect-applications"];
  const settings = useQuery({
    queryKey,
    queryFn: ({ signal }): Promise<Settings> =>
      api("/connect/applications", "GET", undefined, {
        signal,
        user: identity,
      }),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const refetch = settings.refetch;
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible")
        void refetch({ cancelRefetch: false });
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [refetch]);
  const revoke = useMutation({
    mutationFn: (application: Application | null) =>
      api(
        "/connect/revoke",
        "POST",
        application
          ? {
              clientId: application.clientId,
              // Earlier API versions accept only clientId.
              ...(settings.data?.expiredPlatforms && {
                grantId: application.grantId,
              }),
            }
          : {},
        { user: identity },
      ),
  });
  const approval = useMutation({
    mutationFn: ({
      application,
      approvalMode,
    }: {
      application: Application;
      approvalMode: ConnectApprovalMode;
    }) =>
      api(
        "/connect/applications/approval",
        "POST",
        {
          clientId: application.clientId,
          grantId: application.grantId,
          approvalMode,
        },
        { user: identity },
      ) as Promise<{ approvalMode: ConnectApprovalMode }>,
    onSuccess: ({ approvalMode }, { application }) => {
      void cache.cancelQueries({ queryKey });
      cache.setQueryData<Settings>(
        queryKey,
        (current) =>
          current && {
            ...current,
            applications: current.applications.map((app) =>
              app.grantId === application.grantId
                ? { ...app, approvalMode }
                : app,
            ),
          },
      );
      setApprovalTarget(undefined);
      void cache.invalidateQueries({ queryKey });
    },
    onError: () => {
      void cache.invalidateQueries({ queryKey });
    },
  });
  const data = settings.data;
  const canSetUp = data?.enabled && !settings.isError && !!data.resource;
  const applications = data?.applications ?? [];
  if (
    data &&
    !data.enabled &&
    !applications.length &&
    !revoked &&
    !settings.isError
  )
    return null;

  function confirmRevocation() {
    if (!revokeTarget || revoke.isPending) return;
    const target = revokeTarget.application;
    revoke.mutate(target, {
      onSuccess: () => {
        void cache.cancelQueries({ queryKey });
        cache.setQueryData<Settings>(
          queryKey,
          (current) =>
            current && {
              ...current,
              applications: target
                ? current.applications.filter(
                    (app) => app.clientId !== target.clientId,
                  )
                : [],
            },
        );
        setRevoked(true);
        setRevokeTarget(undefined);
        void cache.invalidateQueries({ queryKey });
        requestAnimationFrame(() => heading.current?.focus());
      },
    });
  }

  return (
    <section
      className="settings-card connect-settings"
      aria-labelledby="connect-settings-title"
    >
      <header className="connect-settings-header">
        <span className="connect-symbol">
          <Cable size={23} aria-hidden="true" />
        </span>
        <div>
          <h2 ref={heading} id="connect-settings-title" tabIndex={-1}>
            {translate("connectSettings")}
          </h2>
          {canSetUp && <p>{translate("connectIntro")}</p>}
        </div>
        {applications.length > 1 && (
          <Button
            type="button"
            onClick={() => {
              revoke.reset();
              setRevokeTarget({ application: null });
            }}
          >
            {translate("connectRevokeAll")}
          </Button>
        )}
      </header>
      {settings.isPending && <ConnectLoading grid />}
      {settings.isError && (
        <ConnectNotice tone="error">
          <strong>{translate("connectConnectionError")}</strong>
          <p>{translate("connectSettingsError")}</p>
          <Button
            type="button"
            disabled={settings.isFetching}
            onClick={() => void settings.refetch()}
          >
            {translate("connectRetrySettings")}
          </Button>
        </ConnectNotice>
      )}
      {data && !data.enabled && (
        <ConnectNotice>
          <strong>{translate("connectDisabled")}</strong>
          <p>{translate("connectDisabledDetail")}</p>
        </ConnectNotice>
      )}
      {revoked && (
        <ConnectNotice tone="success">
          {translate("connectDisconnected")}
        </ConnectNotice>
      )}
      {canSetUp && !data.writes && (
        <ConnectNotice>{translate("connectReadOnlyDetail")}</ConnectNotice>
      )}
      {approval.isSuccess && (
        <ConnectNotice tone="success">
          {translate("connectApprovalSaved")}
        </ConnectNotice>
      )}
      {approval.isError && !approvalTarget && (
        <ConnectNotice tone="error">
          {translate("connectApprovalError")}
        </ConnectNotice>
      )}
      {data && (canSetUp || applications.length > 0) && (
        <ul className="connect-grid" aria-label={translate("connectManaged")}>
          {connectPlatforms.map((key) => {
            const { icon: Icon } = assistants[key];
            const name = platformName(key);
            const platformApps = applications.filter(
              (app) => connectPlatformForHost(app.host) === key,
            );
            const count = platformApps.length;
            if (!canSetUp && !count) return null;
            const configured = data.platforms?.[key];
            const expired = data.expiredPlatforms?.includes(key);
            const listing = connectListings[key];
            const setupLabel = !configured
              ? "connectRequirements"
              : expired
                ? "connectReconnect"
                : "connectSetup";
            return (
              <li key={key} className="connect-platform">
                <div className="connect-platform-top">
                  <span className="connect-platform-icon">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <div>
                    <h3>{name}</h3>
                    <p>{translate("connectActiveCount", { count })}</p>
                  </div>
                  <Badge
                    label={
                      count
                        ? data.enabled
                          ? "connectConnected"
                          : "connectPaused"
                        : expired
                          ? "connectConnectionExpired"
                          : "connectNotConnected"
                    }
                    active={!!count && data.enabled}
                  />
                </div>
                {count > 0 ? (
                  <>
                    {canSetUp && <ExamplePrompt applications={platformApps} />}
                    <details className="connect-provider-details">
                      <summary>
                        {translate("connectDetails")}
                        <ChevronDown size={16} aria-hidden="true" />
                      </summary>
                      {platformApps.map((application) => (
                        <ConnectionDetails
                          key={application.grantId ?? application.clientId}
                          application={application}
                          data={data}
                          locale={locale}
                          busy={revoke.isPending || approval.isPending}
                          onApprovalChange={(approvalMode) => {
                            approval.reset();
                            if (approvalMode === "allow")
                              setApprovalTarget(application);
                            else approval.mutate({ application, approvalMode });
                          }}
                          onRevoke={() => {
                            revoke.reset();
                            setRevokeTarget({ application });
                          }}
                        />
                      ))}
                      {canSetUp &&
                        data.expiredPlatforms &&
                        (listing ? (
                          <a
                            className="button"
                            href={listing}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={translate("connectReplaceTitle", {
                              platform: name,
                            })}
                          >
                            {translate("connectReplace")}{" "}
                            <ArrowUpRight size={15} aria-hidden="true" />
                          </a>
                        ) : (
                          configured && (
                            <Button
                              type="button"
                              aria-label={translate("connectReplaceTitle", {
                                platform: name,
                              })}
                              onClick={() =>
                                setSetup({
                                  platform: key,
                                  previous: platformApps.map(
                                    (app) => app.grantId ?? app.clientId,
                                  ),
                                })
                              }
                            >
                              {translate("connectReplace")}
                            </Button>
                          )
                        ))}
                    </details>
                  </>
                ) : listing ? (
                  <a
                    className="button primary"
                    href={listing}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={translate(
                      expired ? "connectReconnectTitle" : "connectListingFor",
                      {
                        platform: name,
                      },
                    )}
                  >
                    {translate(expired ? "connectReconnect" : "connectListing")}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </a>
                ) : (
                  <Button
                    className={configured ? "primary" : ""}
                    type="button"
                    onClick={() => setSetup({ platform: key })}
                    aria-label={translate(
                      !configured
                        ? "connectRequirementsTitle"
                        : expired
                          ? "connectReconnectTitle"
                          : "connectSetupTitle",
                      { platform: name },
                    )}
                  >
                    {translate(setupLabel)}
                    <ArrowRight size={15} aria-hidden="true" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canSetUp &&
        data?.resource &&
        connectPlatforms.some(
          (key) =>
            data.platforms?.[key] &&
            !connectListings[key] &&
            !applications.some(
              (app) => connectPlatformForHost(app.host) === key,
            ),
        ) && (
          <details className="connect-advanced">
            <summary>
              {translate("connectAdvanced")}{" "}
              <ChevronDown size={17} aria-hidden="true" />
            </summary>
            <p>{translate("connectAdvancedHint")}</p>
            <ConnectionAddress resource={data.resource} />
          </details>
        )}
      {setup && data && (
        <SetupDialog
          key={setup.platform}
          platform={setup.platform}
          resource={
            canSetUp && data.platforms?.[setup.platform] ? data.resource : null
          }
          replacing={!!setup.previous}
          applications={
            canSetUp
              ? applications.filter(
                  (app) =>
                    connectPlatformForHost(app.host) === setup.platform &&
                    !setup.previous?.includes(app.grantId ?? app.clientId),
                )
              : []
          }
          onClose={() => setSetup(undefined)}
        />
      )}
      {approvalTarget && (
        <Dialog
          title={translate("connectApprovalTitle", {
            name: approvalTarget.name,
          })}
          description={translate("connectApprovalRisk")}
          busy={approval.isPending}
          onClose={() => {
            approval.reset();
            setApprovalTarget(undefined);
          }}
        >
          <div className="connect-dialog-body">
            <div className="connect-granted">
              <strong>{translate("connectApprovalWrites")}</strong>
              <ul>
                {approvalTarget.scopes
                  .filter((scope) => scope.endsWith(":write"))
                  .map((scope) => (
                    <li key={scope}>{translate(scopeLabels[scope])}</li>
                  ))}
              </ul>
            </div>
            {approval.isError && (
              <ConnectNotice tone="error">
                {translate("connectApprovalError")}
              </ConnectNotice>
            )}
            <div className="connect-actions">
              <Button
                type="button"
                disabled={approval.isPending}
                onClick={() => {
                  approval.reset();
                  setApprovalTarget(undefined);
                }}
              >
                {translate("cancel")}
              </Button>
              <Button
                type="button"
                className="primary"
                disabled={approval.isPending}
                onClick={() =>
                  approval.mutate({
                    application: approvalTarget,
                    approvalMode: "allow",
                  })
                }
              >
                {translate(
                  approval.isPending ? "connectLoad" : "connectApprovalAllow",
                )}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      {revokeTarget && (
        <Dialog
          title={
            revokeTarget.application
              ? translate("connectDisconnectTitle", {
                  name: revokeTarget.application.name,
                })
              : translate("connectDisconnectAllTitle")
          }
          description={translate("connectRevokeNote")}
          busy={revoke.isPending}
          onClose={() => setRevokeTarget(undefined)}
        >
          <div className="connect-dialog-body">
            {revoke.isError && (
              <ConnectNotice tone="error">
                {translate("connectDisconnectError")}
              </ConnectNotice>
            )}
            <div className="connect-actions">
              <Button
                type="button"
                disabled={revoke.isPending}
                onClick={() => setRevokeTarget(undefined)}
              >
                {translate("cancel")}
              </Button>
              <Button
                type="button"
                className="primary"
                disabled={revoke.isPending}
                onClick={confirmRevocation}
              >
                {translate(
                  revoke.isPending
                    ? "connectLoad"
                    : revokeTarget.application
                      ? "connectRevoke"
                      : "connectRevokeAll",
                )}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
