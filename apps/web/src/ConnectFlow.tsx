import { LegalLinks } from "./legal";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  LockKeyhole,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import type { User } from "firebase/auth";
import { api } from "./api";
import { Button } from "./ui";
import { Logo } from "./components";
import { LanguageSwitch } from "./i18n/LanguageSwitch";
import {
  systemMessage,
  translate,
  useLanguage,
  type Language,
  type MessageKey,
} from "./i18n";
import {
  ConnectLoading,
  ConnectNotice,
  scopeLabels,
  type ConnectScope,
} from "./connect-ui";

type Consent = {
  name: string;
  host: string;
  scopes: ConnectScope[];
  replacementRequired?: boolean;
  replacements?: {
    grantId: string;
    name: string;
    host: string;
    connectedAt: string;
  }[];
};
type Action = {
  action: "create_topic" | "complete_review" | "reschedule_review";
  application: string;
  input: {
    title?: string;
    notes?: string;
    initialKnowledge?: number | null;
    importance?: number | null;
    duration?: number;
    tags?: string[];
    materials?: string[];
    rating?: number;
    scheduledAt?: string;
  };
  preview: {
    title?: string;
    previous?: string | null;
    duration?: number;
    timezone?: string;
    warnings?: string[];
  };
  state: "pending" | "approved" | "cancelled";
};
type FlowProps = {
  mode: "authorize" | "confirm";
  accountId?: string;
  identity?: User;
  email?: string;
  loading: boolean;
  signingIn: boolean;
  error: string;
  dark: boolean;
  savingLanguage: boolean;
  onLanguageChange: (language: Language) => void;
  onToggleTheme: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onRetrySignIn: () => void;
};
type FlowResponse =
  Consent | Action | { unavailable: "expired" | "disabled" | "read-only" };
const actions: Record<
  Action["action"],
  { label: MessageKey; icon: typeof Sun }
> = {
  create_topic: { label: "connectNewTopic", icon: ClipboardCheck },
  complete_review: { label: "connectComplete", icon: ClipboardCheck },
  reschedule_review: { label: "connectReschedule", icon: CalendarClock },
};

export function ConnectFlow({
  mode,
  accountId,
  identity,
  email,
  loading,
  signingIn,
  error: authError,
  dark,
  savingLanguage,
  onLanguageChange,
  onToggleTheme,
  onSignIn,
  onSignOut,
  onRetrySignIn,
}: FlowProps) {
  const locale = useLanguage();
  const address = location.hash.slice(1);
  const valid = (
    mode === "authorize" ? /^[A-Za-z0-9_-]{43}$/ : /^[a-f0-9]{64}$/
  ).test(address);
  const path =
    "/connect/" + (mode === "authorize" ? "consent/" : "actions/") + address;
  const [selected, setSelected] = useState<ConnectScope[]>();
  const [replacementGrantId, setReplacementGrantId] = useState("");
  const [working, setWorking] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [decision, setDecision] = useState<Action["state"]>();
  const request = useQuery({
    queryKey: ["account", accountId, "connect-request", mode, address],
    enabled: Boolean(accountId && email && valid),
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }): Promise<FlowResponse> => {
      try {
        return await api(path, "GET", undefined, { user: identity, signal });
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
        const config = await api("/connect/applications", "GET", undefined, {
          user: identity,
          signal,
        });
        return {
          unavailable: !config.enabled
            ? "disabled"
            : mode === "confirm" && !config.writes
              ? "read-only"
              : "expired",
        };
      }
    },
  });
  const data = request.data;
  const consent = data && "scopes" in data ? data : undefined;
  const action = data && "action" in data ? data : undefined;
  const state = decision ?? action?.state ?? "pending";
  const scopes =
    selected ??
    consent?.scopes.filter(
      (scope) => scope === "topics:read" || scope === "reviews:read",
    ) ??
    [];

  const replacement = consent?.replacements?.find(
    (option) => option.grantId === replacementGrantId,
  );
  const mustChooseReplacement = !!consent?.replacementRequired && !replacement;
  async function decide(allow: boolean) {
    if (working || (allow && mustChooseReplacement)) return;
    setWorking(true);
    setSaveError(false);
    try {
      if (consent) {
        const result = await api(
          path,
          "POST",
          {
            scopes: allow ? scopes : [],
            ...(allow &&
              replacement && { replacementGrantId: replacement.grantId }),
          },
          { user: identity },
        );
        location.replace(result.url);
        return;
      }
      const result = await api(path, "POST", { allow }, { user: identity });
      setDecision(result.state);
    } catch (error) {
      if (consent && (error as { status?: number }).status === 409) {
        setReplacementGrantId("");
        void request.refetch();
      }
      setSaveError(true);
    }
    setWorking(false);
  }

  const showActions = Boolean(consent || (action && state === "pending"));
  return (
    <main className="connect-flow">
      <header className="connect-flow-header">
        <a href="/" aria-label={translate("connectOpen")}>
          <Logo />
        </a>
        <div className="connect-header-controls">
          <LanguageSwitch
            onSelect={onLanguageChange}
            disabled={savingLanguage}
          />
          <Button
            type="button"
            className="icon-button"
            aria-label={translate("theme")}
            onClick={onToggleTheme}
          >
            {dark ? <Sun size={19} /> : <Moon size={19} />}
          </Button>
        </div>
      </header>
      <section
        className="settings-card connect-flow-card"
        aria-labelledby="connect-flow-title"
      >
        <div className="connect-flow-heading">
          <span className="connect-symbol">
            {mode === "authorize" ? (
              <ShieldCheck size={25} aria-hidden="true" />
            ) : (
              <ClipboardCheck size={25} aria-hidden="true" />
            )}
          </span>
          <h1 id="connect-flow-title">
            {translate(
              mode === "authorize" ? "connectAuthorize" : "connectConfirm",
            )}
          </h1>
          <p>
            {translate(
              mode === "authorize" ? "connectFlowIntro" : "connectConfirmIntro",
            )}
          </p>
        </div>
        {loading ? (
          <ConnectLoading />
        ) : !valid ? (
          <ConnectNotice tone="error">
            <strong>{translate("connectExpired")}</strong>
            <p>{translate("connectLoadError")}</p>
          </ConnectNotice>
        ) : !email ? (
          <div className="connect-sign-in">
            <p>{translate("connectSignInHint")}</p>
            {authError && (
              <ConnectNotice tone="error">
                {systemMessage(authError)}
              </ConnectNotice>
            )}
            <div className="connect-actions">
              <Button
                type="button"
                className="primary"
                disabled={signingIn}
                onClick={onSignIn}
              >
                <img
                  className="google-g"
                  src="/google-g.png"
                  width="20"
                  height="20"
                  alt=""
                />
                {translate(signingIn ? "connectLoad" : "connectSignIn")}
              </Button>
              {authError && (
                <Button type="button" onClick={onRetrySignIn}>
                  {translate("retry")}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="connect-signed-in">
              <div>
                <span>{translate("connectSignedIn")}</span>
                <strong>{email}</strong>
              </div>
              <Button type="button" disabled={working} onClick={onSignOut}>
                {translate("connectSignOut")}
              </Button>
            </div>
            {authError === "languageSync" && (
              <ConnectNotice tone="error">
                {systemMessage(authError)}
              </ConnectNotice>
            )}
            {request.isPending && <ConnectLoading />}
            {request.isError && (
              <ConnectNotice tone="error">
                <strong>{translate("connectConnectionError")}</strong>
                <p>{translate("connectLoadError")}</p>
                <Button
                  type="button"
                  disabled={request.isFetching}
                  onClick={() => void request.refetch()}
                >
                  {translate("retry")}
                </Button>
              </ConnectNotice>
            )}
            {data && "unavailable" in data && (
              <ConnectNotice
                tone={data.unavailable === "expired" ? "error" : "info"}
              >
                <strong>
                  {translate(
                    data.unavailable === "expired"
                      ? "connectExpired"
                      : "connectDisabled",
                  )}
                </strong>
                <p>
                  {translate(
                    data.unavailable === "expired"
                      ? "connectLoadError"
                      : data.unavailable === "read-only"
                        ? "connectConfirmDisabled"
                        : "connectDisabledDetail",
                  )}
                </p>
              </ConnectNotice>
            )}
            {consent && (
              <>
                <div className="connect-request-identity">
                  <span className="connect-platform-icon">
                    <LockKeyhole size={19} aria-hidden="true" />
                  </span>
                  <div>
                    <h2>{consent.name}</h2>
                    <p>
                      {translate("connectDestination")}{" "}
                      <bdi>{consent.host}</bdi>
                    </p>
                  </div>
                </div>
                <p className="connect-sharing">{translate("connectShare")}</p>
                <div className="connect-permissions">
                  {[false, true].map((write) => {
                    const requested = consent.scopes.filter(
                      (scope) => scope.endsWith(":write") === write,
                    );
                    if (!requested.length) return null;
                    return (
                      <fieldset key={String(write)} disabled={working}>
                        <legend>
                          {translate(write ? "connectWrite" : "connectRead")}
                        </legend>
                        {requested.map((scope) => (
                          <label className="connect-scope" key={scope}>
                            <input
                              type="checkbox"
                              checked={scopes.includes(scope)}
                              onChange={(event) =>
                                setSelected(
                                  event.currentTarget.checked
                                    ? [...scopes, scope]
                                    : scopes.filter((item) => item !== scope),
                                )
                              }
                            />
                            <span>{translate(scopeLabels[scope])}</span>
                          </label>
                        ))}
                        {write && <p>{translate("connectWriteNotice")}</p>}
                      </fieldset>
                    );
                  })}
                </div>
                {!!consent.replacements?.length && (
                  <div className="connect-approval">
                    <label>
                      <strong>{translate("connectReplacement")}</strong>
                      <select
                        value={replacementGrantId}
                        disabled={working}
                        onChange={(event) =>
                          setReplacementGrantId(event.target.value)
                        }
                      >
                        <option value="">
                          {translate(
                            consent.replacementRequired
                              ? "connectChooseReplacement"
                              : "connectKeepConnections",
                          )}
                        </option>
                        {consent.replacements.map((option) => (
                          <option key={option.grantId} value={option.grantId}>
                            {translate("connectReplacementOption", {
                              name: option.name,
                              host: option.host,
                              date: new Intl.DateTimeFormat(locale, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              }).format(new Date(option.connectedAt)),
                            })}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p>{translate("connectReplacementNote")}</p>
                  </div>
                )}
                <p className="connect-sharing">
                  {translate("connectRevokeNote")}
                </p>
              </>
            )}
            {action && state === "pending" && (
              <ActionDetails action={action} locale={locale} />
            )}
            {saveError && (
              <ConnectNotice tone="error">
                {translate("connectSaveError")}
              </ConnectNotice>
            )}
            {showActions && (
              <div className="connect-actions connect-flow-actions">
                <Button
                  type="button"
                  disabled={working}
                  onClick={() => void decide(false)}
                >
                  {translate("cancel")}
                </Button>
                <Button
                  type="button"
                  className="primary"
                  disabled={
                    working ||
                    Boolean(
                      consent && (!scopes.length || mustChooseReplacement),
                    )
                  }
                  onClick={() => void decide(true)}
                >
                  {translate(
                    working
                      ? "connectLoad"
                      : consent
                        ? "connectAllow"
                        : "connectApprove",
                  )}
                  <ArrowRight size={16} aria-hidden="true" />
                </Button>
              </div>
            )}
            {action && state !== "pending" && (
              <ConnectNotice tone={state === "approved" ? "success" : "info"}>
                <strong>
                  {translate(
                    state === "approved"
                      ? "connectSuccessTitle"
                      : "connectCancelTitle",
                  )}
                </strong>
                {state === "approved" && <p>{translate("connectApproved")}</p>}
              </ConnectNotice>
            )}
          </>
        )}
        <a className="connect-back" href="/">
          <ArrowLeft size={16} aria-hidden="true" /> {translate("connectOpen")}
        </a>
      </section>
      <footer>
        <LegalLinks />
      </footer>
    </main>
  );
}

function localTime(
  value: string | null | undefined,
  locale: Language,
  timezone?: string,
) {
  if (!value) return null;
  const time = new Date(value);
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(time);
  } catch {
    return value;
  }
}

function ActionDetails({
  action,
  locale,
}: {
  action: Action;
  locale: Language;
}) {
  const { input, preview } = action;
  const { label, icon: Icon } = actions[action.action];
  const details: [MessageKey, string | number | null | undefined][] = [
    ["connectTopic", input.title ?? preview.title],
    ["connectRatingRecall", input.rating],
    ["connectRatingInitial", input.initialKnowledge],
    ["connectImportance", input.importance],
    ["connectDuration", input.duration ?? preview.duration],
    ["connectTags", input.tags?.join(", ")],
    ["connectNotes", input.notes],
    ["connectMaterials", input.materials?.join("\n")],
    ["connectPrevious", localTime(preview.previous, locale, preview.timezone)],
    [
      "connectScheduled",
      localTime(input.scheduledAt, locale, preview.timezone),
    ],
    ["connectTimezone", preview.timezone],
  ];
  return (
    <div className="connect-action-details">
      <div className="connect-request-identity">
        <span className="connect-platform-icon">
          <Icon size={20} aria-hidden="true" />
        </span>
        <div>
          <h2>{translate(label)}</h2>
          <p>
            {translate("connectClient")} <bdi>{action.application}</bdi>
          </p>
        </div>
      </div>
      <dl>
        {details
          .filter(([, value]) => value != null && value !== "")
          .map(([key, value]) => (
            <div key={key}>
              <dt>{translate(key)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {Boolean(preview.warnings?.length) && (
        <ConnectNotice>
          <strong>{translate("connectWarnings")}</strong>
          <ul>
            {preview.warnings?.map((warning) => (
              <li key={warning}>{systemMessage(warning)}</li>
            ))}
          </ul>
        </ConnectNotice>
      )}
    </div>
  );
}
