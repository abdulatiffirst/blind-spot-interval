import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Cable,
  ChevronDown,
  Copy,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Sun,
} from "lucide-react";
import type { User } from "firebase/auth";
import {
  connectPlatformForHost,
  connectPlatforms,
  type ConnectPlatform,
} from "../../../packages/shared/src/connect-platforms.ts";
import { api } from "./api";
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
    hint: "connectChatgptHint",
    requirement: "connectChatgptRequirement",
    steps: [
      "connectChatgptStep1",
      "connectChatgptStep2",
      "connectChatgptStep3",
    ],
    docs: "https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt",
  },
  claude: {
    name: "Claude",
    icon: Sun,
    hint: "connectClaudeHint",
    requirement: "connectClaudeRequirement",
    steps: ["connectClaudeStep1", "connectClaudeStep2", "connectClaudeStep3"],
    docs: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
  },
  gemini: {
    name: "Gemini",
    icon: Sparkles,
    hint: "connectGeminiHint",
    requirement: "connectGeminiRequirement",
    steps: ["connectGeminiStep1", "connectGeminiStep2", "connectGeminiStep3"],
    docs: "https://developers.google.com/connected-apps/mcp/dev-mode/usage",
  },
  other: {
    name: "",
    icon: Bot,
    hint: "connectOtherHint",
    requirement: "connectOtherRequirement",
    steps: ["connectOtherStep1", "connectOtherStep2", "connectOtherStep3"],
    docs: undefined,
  },
} satisfies Record<
  ConnectPlatform,
  {
    name: string;
    icon: typeof Bot;
    hint: MessageKey;
    requirement: MessageKey;
    steps: MessageKey[];
    docs?: string;
  }
>;

type Application = {
  clientId: string;
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

function ConnectionAddress({ resource }: { resource: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<"copied" | "failed">();
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(resource);
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
        <span>{translate("connectUrl")}</span>
        <input
          ref={input}
          readOnly
          value={resource}
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <Button type="button" onClick={() => void copyAddress()}>
        <Copy size={16} aria-hidden="true" />
        {translate("connectCopy")}
      </Button>
      {result && (
        <p role="status">
          {translate(
            result === "copied" ? "connectCopied" : "connectCopyError",
          )}
        </p>
      )}
    </div>
  );
}

function SetupDialog({
  platform,
  resource,
  onClose,
}: {
  platform: ConnectPlatform;
  resource: string | null;
  onClose: () => void;
}) {
  const item = assistants[platform];
  const name = platformName(platform);
  return (
    <Dialog
      title={translate(
        resource ? "connectSetupTitle" : "connectRequirementsTitle",
        { platform: name },
      )}
      description={translate(
        resource ? "connectSetupDescription" : "connectUnavailableDetail",
        { platform: name },
      )}
      onClose={onClose}
    >
      <div className="connect-dialog-body">
        <p>{translate(item.requirement)}</p>
        {resource && (
          <>
            <ol className="connect-steps">
              {item.steps.map((step) => (
                <li key={step}>{translate(step)}</li>
              ))}
            </ol>
            <ConnectionAddress resource={resource} />
          </>
        )}
        {item.docs && (
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

function ApplicationCard({
  application,
  data,
  locale,
  onRevoke,
  busy,
}: {
  application: Application;
  data: Settings;
  locale: Language;
  busy: boolean;
  onRevoke: () => void;
}) {
  const { clientId, name, host, scopes, connectedAt } = application;
  const time = new Date(connectedAt);
  const date = Number.isFinite(time.getTime())
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(time)
    : null;
  const access = accessLabel(application, data);
  return (
    <article
      id={"connect-app-" + clientId}
      tabIndex={-1}
      className="connect-application"
    >
      <div className="connect-app-summary">
        <div className="connect-app-identity">
          <h4>{name}</h4>
          <p>{host}</p>
          {date && (
            <p>
              <time dateTime={connectedAt}>
                {translate("connectConnectedOn", { date })}
              </time>
            </p>
          )}
        </div>
        <Badge label={access} active={access !== "connectPaused"} />
      </div>
      <div className="connect-granted">
        <strong>{translate("connectPermissions")}</strong>
        <ul>
          {scopes.map((scope) => (
            <li key={scope}>{translate(scopeLabels[scope])}</li>
          ))}
        </ul>
      </div>
      <Button type="button" disabled={busy} onClick={onRevoke}>
        {translate("connectRevoke")}
      </Button>
    </article>
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
  const [platform, setPlatform] = useState<ConnectPlatform>();
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget>();
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
  });
  const revoke = useMutation({
    mutationFn: (application: Application | null) =>
      api(
        "/connect/revoke",
        "POST",
        application ? { clientId: application.clientId } : {},
        { user: identity },
      ),
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
        {!!applications.length && canSetUp && (
          <a className="button connect-jump" href="#connect-authorized">
            {translate("connectMoreAccess")}{" "}
            <ArrowDown size={15} aria-hidden="true" />
          </a>
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
      {canSetUp && data && (
        <>
          {!data.writes && (
            <ConnectNotice>{translate("connectReadOnlyDetail")}</ConnectNotice>
          )}
          <ul className="connect-grid">
            {connectPlatforms.map((key) => {
              const { icon: Icon, hint } = assistants[key];
              const name = platformName(key);
              const platformApps = applications.filter(
                (app) => connectPlatformForHost(app.host) === key,
              );
              const [connected] = platformApps;
              const configured = data.platforms?.[key];
              return (
                <li key={key} className="connect-platform">
                  <div className="connect-platform-top">
                    <span className="connect-platform-icon">
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <Badge
                      label={
                        connected
                          ? "connectConnected"
                          : configured
                            ? "connectNotConnected"
                            : "connectPlatformUnavailable"
                      }
                      active={!!connected}
                    />
                  </div>
                  <div>
                    <h3>{name}</h3>
                    <p>{translate(hint)}</p>
                    {platformApps.length === 1 && (
                      <p className="connect-access-summary">
                        {translate(accessLabel(connected, data))}
                      </p>
                    )}
                  </div>
                  {connected ? (
                    <div className="connect-platform-actions">
                      <a
                        className="button"
                        href={
                          platformApps.length === 1
                            ? "#connect-app-" + connected.clientId
                            : "#connect-authorized"
                        }
                        aria-label={translate("connectManagePlatform", {
                          platform: name,
                        })}
                      >
                        {translate("connectManage")}{" "}
                        <ArrowRight size={15} aria-hidden="true" />
                      </a>
                      {configured && (
                        <Button
                          type="button"
                          className="text-button"
                          aria-label={translate("connectSetupGuideFor", {
                            platform: name,
                          })}
                          onClick={() => setPlatform(key)}
                        >
                          {translate("connectSetupGuide")}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <Button
                      className={configured ? "primary" : ""}
                      type="button"
                      onClick={() => setPlatform(key)}
                      aria-label={translate(
                        configured
                          ? "connectSetupTitle"
                          : "connectRequirementsTitle",
                        { platform: name },
                      )}
                    >
                      {translate(
                        configured ? "connectSetup" : "connectRequirements",
                      )}
                      <ArrowRight size={15} aria-hidden="true" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="connect-manual-note">
            {translate("connectManualNote")}
          </p>
        </>
      )}
      {data && (data.enabled || applications.length > 0) && (
        <div className="connect-applications">
          <div className="connect-applications-header">
            <h3 id="connect-authorized" tabIndex={-1}>
              <ShieldCheck size={20} aria-hidden="true" />{" "}
              {translate("connectManaged")}
            </h3>
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
          </div>
          {applications.length ? (
            <div className="connect-grants">
              {applications.map((application) => (
                <ApplicationCard
                  key={application.clientId}
                  application={application}
                  data={data}
                  locale={locale}
                  busy={revoke.isPending}
                  onRevoke={() => {
                    revoke.reset();
                    setRevokeTarget({ application });
                  }}
                />
              ))}
            </div>
          ) : (
            <p className="connect-empty">{translate("connectNoApps")}</p>
          )}
        </div>
      )}
      {canSetUp &&
        data?.resource &&
        Object.values(data.platforms ?? {}).some(Boolean) && (
          <details className="connect-advanced">
            <summary>
              {translate("connectAdvanced")}{" "}
              <ChevronDown size={17} aria-hidden="true" />
            </summary>
            <p>{translate("connectAdvancedHint")}</p>
            <ConnectionAddress resource={data.resource} />
          </details>
        )}
      {platform && data && (
        <SetupDialog
          key={platform}
          platform={platform}
          resource={
            canSetUp && data.platforms?.[platform] ? data.resource : null
          }
          onClose={() => setPlatform(undefined)}
        />
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
