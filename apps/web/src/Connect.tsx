import { useLanguage } from "./i18n";
import { useEffect, useState } from "react";
import { api } from "./api";
import { Button } from "./ui";
import { Logo } from "./components";

const copy = {
  en: {
    settings: "Connected AI Applications",
    authorize: "Authorize an AI application",
    confirm: "Confirm a Blind Spot action",
    unavailable: "Blind Spot Connect is unavailable.",
    noApps: "No applications connected.",
    load: "Loading…",
    loadError:
      "Could not load this request. It may have expired. Open a new request from your AI application.",
    saveError:
      "Could not apply your decision. If the review or its availability changed, request a new confirmation.",
    signIn: "Continue with Google",
    signOut: "Sign out to switch accounts",
    allow: "Allow selected permissions",
    cancel: "Cancel",
    approve: "Apply this change",
    approved:
      "Change applied. Return to your AI application to check the result.",
    cancelled: "Request cancelled.",
    open: "Open Blind Spot",
    read: "Read permissions",
    write: "Write permissions",
    share:
      "The selected permissions let this application share the corresponding learning data with its AI provider.",
    revokeNote:
      "Revoking access prevents future requests. The provider may retain data it already received.",
    client: "Application",
    destination: "Callback domain",
    connected: "Connected",
    disconnected: "Access revoked.",
    revoke: "Revoke access",
    revokeAll: "Revoke all access",
    revokeConfirm: "Revoke access for the selected application(s)?",
    url: "MCP server URL",
    copy: "Copy URL",
    copied: "URL copied.",
    copyError: "Select and copy the URL manually.",
    readOnly: "Read-only mode is active.",
    setup: "Client setup and availability",
    unverified:
      "Compatibility is unverified. Access to remote MCP integrations depends on the client, account and region.",
    platforms: [
      [
        "Claude",
        "Open Settings → Connectors → Add custom connector. Enter the URL and follow the OAuth prompt.",
      ],
      [
        "ChatGPT",
        "If your workspace offers Developer mode, use Settings → Apps to create a custom app. Choose OAuth. Available tools depend on your plan and permissions.",
      ],
      [
        "Gemini",
        "A consumer Gemini app connection has not been verified. Gemini CLI can be configured with a remote MCP httpUrl and an OAuth client approved on this server.",
      ],
      [
        "Other MCP clients",
        "Use a remote Streamable HTTP server with OAuth authorization code and S256 PKCE. Client registration or an approved client ID is required.",
      ],
    ],
    topicsRead: "Read learning topics and materials",
    topicsWrite: "Request creation of learning topics",
    reviewsRead: "Read review schedules and scheduling preferences",
    historyRead:
      "Read completed reviews, recorded ratings, and learning statistics with the other read permissions",
    reviewsWrite: "Request review completion or rescheduling",
    newTopic: "Create a topic",
    complete: "Complete a review",
    reschedule: "Reschedule a review",
    topic: "Topic",
    rating: "Knowledge rating",
    importance: "Importance",
    duration: "Duration (minutes)",
    tags: "Tags",
    notes: "Notes",
    materials: "Materials",
    previous: "Current review time",
    scheduled: "Requested time",
    timezone: "Study timezone",
    warnings: "Scheduling warnings",
    warningMessages: [
      "Manual time overlaps another review.",
      "Manual time is outside your preferred study hours.",
      "Manual time overlaps Google Calendar availability.",
      "Manual time is outside your preferred scheduling window.",
    ],
  },
  ru: {
    settings: "Подключённые ИИ-приложения",
    authorize: "Разрешить доступ ИИ-приложению",
    confirm: "Подтвердить действие в Blind Spot",
    unavailable: "Blind Spot Connect недоступен.",
    noApps: "Нет подключённых приложений.",
    load: "Загрузка…",
    loadError:
      "Не удалось загрузить запрос. Возможно, срок действия истёк. Откройте новый запрос из ИИ-приложения.",
    saveError:
      "Не удалось сохранить решение. Если повторение или доступность времени изменились, запросите новое подтверждение.",
    signIn: "Войти через Google",
    signOut: "Выйти, чтобы сменить аккаунт",
    allow: "Разрешить выбранный доступ",
    cancel: "Отмена",
    approve: "Применить изменение",
    approved:
      "Изменение применено. Вернитесь в ИИ-приложение, чтобы узнать результат.",
    cancelled: "Запрос отменён.",
    open: "Открыть Blind Spot",
    read: "Доступ на чтение",
    write: "Доступ на запись",
    share:
      "С выбранными разрешениями приложение сможет передавать соответствующие учебные данные поставщику ИИ.",
    revokeNote:
      "Отзыв доступа остановит новые запросы. Поставщик может сохранить ранее полученные данные.",
    client: "Приложение",
    destination: "Домен переадресации",
    connected: "Подключено",
    disconnected: "Доступ отозван.",
    revoke: "Отозвать доступ",
    revokeAll: "Отозвать весь доступ",
    revokeConfirm: "Отозвать доступ выбранных приложений?",
    url: "Адрес MCP-сервера",
    copy: "Скопировать адрес",
    copied: "Адрес скопирован.",
    copyError: "Выделите и скопируйте адрес вручную.",
    readOnly: "Включён режим чтения.",
    setup: "Настройка и доступность клиентов",
    unverified:
      "Совместимость не проверена. Доступ к удалённым MCP-интеграциям зависит от клиента, аккаунта и региона.",
    platforms: [
      [
        "Claude",
        "В настройках откройте раздел Connectors и выберите Add custom connector. Введите адрес и пройдите авторизацию OAuth.",
      ],
      [
        "ChatGPT",
        "Если в рабочем пространстве доступен режим разработчика, создайте приложение в разделе Apps и выберите OAuth. Набор инструментов зависит от тарифа и разрешений.",
      ],
      [
        "Gemini",
        "Подключение в пользовательском приложении Gemini не проверено. Для Gemini CLI можно указать MCP-адрес httpUrl и одобренный сервером клиент OAuth.",
      ],
      [
        "Другие MCP-клиенты",
        "Используйте Streamable HTTP с OAuth и S256 PKCE. Требуется зарегистрированный или заранее одобренный идентификатор клиента.",
      ],
    ],
    topicsRead: "Читать темы и учебные материалы",
    topicsWrite: "Запрашивать создание тем",
    reviewsRead: "Читать расписание и настройки повторений",
    historyRead:
      "Читать историю, оценки и статистику при наличии других разрешений на чтение",
    reviewsWrite: "Запрашивать завершение или перенос повторений",
    newTopic: "Создать тему",
    complete: "Завершить повторение",
    reschedule: "Перенести повторение",
    topic: "Тема",
    rating: "Уровень знаний",
    importance: "Важность",
    duration: "Длительность (мин.)",
    tags: "Теги",
    notes: "Заметки",
    materials: "Материалы",
    previous: "Текущее время повторения",
    scheduled: "Запрошенное время",
    timezone: "Учебный часовой пояс",
    warnings: "Предупреждения о расписании",
    warningMessages: [
      "Это время пересекается с другим повторением.",
      "Это время выходит за пределы учебных часов.",
      "Это время занято в Календаре Google.",
      "Это время находится за пределами предпочтительного окна повторений.",
    ],
  },
};
const scopeLabels = {
  "topics:read": "topicsRead",
  "topics:write": "topicsWrite",
  "reviews:read": "reviewsRead",
  "reviews:write": "reviewsWrite",
  "reviews:history:read": "historyRead",
} as const;
type Scope = keyof typeof scopeLabels;
type Locale = keyof typeof copy;
type Messages = typeof copy.en;
const localeKey = "blind-spot-connect-language";
function useLocale() {
  const appLanguage = useLanguage();
  const [selected, set] = useState<Locale | null>(() => {
    const saved = localStorage.getItem(localeKey);
    return saved === "ru" || saved === "en" ? saved : null;
  });
  const locale = selected ?? appLanguage;
  return {
    locale,
    messages: copy[locale],
    selector: (
      <select
        aria-label="Language / Язык"
        value={locale}
        onChange={(e) => {
          const next = e.target.value as Locale;
          localStorage.setItem(localeKey, next);
          set(next);
        }}
      >
        <option value="en">English</option>
        <option value="ru">Русский</option>
      </select>
    ),
  };
}
type Application = {
  clientId: string;
  name: string;
  host: string;
  scopes: Scope[];
  connectedAt: string;
};
type Settings = {
  enabled: boolean;
  resource: string | null;
  writes: boolean;
  applications: Application[];
};
export function ConnectSettings() {
  const { messages: t, locale, selector } = useLocale();
  const [data, setData] = useState<Settings>();
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<
    "copied" | "copyError" | "disconnected"
  >();
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api("/connect/applications", "GET", undefined, {
      signal: controller.signal,
    })
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);
  async function disconnect(clientId?: string) {
    if (!window.confirm(t.revokeConfirm)) return;
    setWorking(true);
    setError(false);
    try {
      await api("/connect/revoke", "POST", clientId ? { clientId } : {});
      setData(await api("/connect/applications"));
      setNotice("disconnected");
    } catch {
      setError(true);
    } finally {
      setWorking(false);
    }
  }
  return (
    <section className="settings-card connect-card" lang={locale}>
      <div className="inline">
        <h2>{t.settings}</h2>
        {selector}
      </div>
      {!data && !error && <p role="status">{t.load}</p>}
      {error && <p role="alert">{t.loadError}</p>}
      {notice && <p role="status">{t[notice]}</p>}
      {data && !data.enabled && <p>{t.unavailable}</p>}
      {data?.enabled && data.resource && (
        <>
          <label>
            {t.url}
            <input
              readOnly
              value={data.resource}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(data.resource!);
                setNotice("copied");
              } catch {
                setNotice("copyError");
              }
            }}
          >
            {t.copy}
          </Button>
          {!data.writes && <p>{t.readOnly}</p>}
          <details>
            <summary>{t.setup}</summary>
            <p>{t.unverified}</p>
            <ul>
              {t.platforms.map(([name, steps]) => (
                <li key={name}>
                  <strong>{name}</strong> — {steps}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      {data?.enabled && !data.applications.length && <p>{t.noApps}</p>}
      {data?.applications.map((application) => (
        <div key={application.clientId} className="connect-application">
          <h3>
            {application.name} · {application.host}
          </h3>
          <p>
            {t.connected} ·{" "}
            {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
              new Date(application.connectedAt),
            )}
          </p>
          <ul>
            {application.scopes.map((scope) => (
              <li key={scope}>{t[scopeLabels[scope]]}</li>
            ))}
          </ul>
          <Button
            disabled={working}
            onClick={() => void disconnect(application.clientId)}
          >
            {t.revoke}
          </Button>
        </div>
      ))}
      {!!data?.applications.length && (
        <>
          <p>{t.revokeNote}</p>
          <Button disabled={working} onClick={() => void disconnect()}>
            {t.revokeAll}
          </Button>
        </>
      )}
    </section>
  );
}

type Consent = { name: string; host: string; scopes: Scope[] };
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
  email?: string;
  loading: boolean;
  signingIn: boolean;
  error: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
};
export function ConnectFlow({
  mode,
  email,
  loading,
  signingIn,
  error: authError,
  onSignIn,
  onSignOut,
}: FlowProps) {
  const { messages: t, locale, selector } = useLocale();
  const address = location.hash.slice(1);
  const valid = (
    mode === "authorize" ? /^[A-Za-z0-9_-]{43}$/ : /^[a-f0-9]{64}$/
  ).test(address);
  const path =
    "/connect/" + (mode === "authorize" ? "consent/" : "actions/") + address;
  const [data, setData] = useState<Consent | Action>();
  const [selected, setSelected] = useState<Scope[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<"loadError" | "saveError">();
  const [state, setState] = useState<Action["state"]>("pending");
  useEffect(() => {
    setData(undefined);
    setSelected([]);
    setState("pending");
    setError(undefined);
    if (!email || !valid) return;
    const controller = new AbortController();
    api(path, "GET", undefined, { signal: controller.signal })
      .then((response: Consent | Action) => {
        setData(response);
        if ("scopes" in response)
          setSelected(
            response.scopes.filter(
              (scope) => scope === "topics:read" || scope === "reviews:read",
            ),
          );
        else setState(response.state);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("loadError");
      });
    return () => controller.abort();
  }, [email, path, valid]);
  async function decide(allow: boolean) {
    setWorking(true);
    setError(undefined);
    try {
      if (mode === "authorize") {
        const result = await api(path, "POST", {
          scopes: allow ? selected : [],
        });
        location.replace(result.url);
      } else setState((await api(path, "POST", { allow })).state);
    } catch {
      setError("saveError");
    } finally {
      setWorking(false);
    }
  }
  return (
    <main className="connect-flow" lang={locale}>
      <header className="inline">
        <Logo />
        {selector}
      </header>
      <section className="settings-card connect-card">
        <h1>{mode === "authorize" ? t.authorize : t.confirm}</h1>
        {loading ? (
          <p role="status">{t.load}</p>
        ) : !valid ? (
          <p role="alert">{t.loadError}</p>
        ) : !email ? (
          <>
            {authError && <p role="alert">{t.loadError}</p>}
            <Button className="primary" disabled={signingIn} onClick={onSignIn}>
              <img
                className="google-g"
                src="/google-g.png"
                width="20"
                height="20"
                alt=""
              />
              {signingIn ? t.load : t.signIn}
            </Button>
          </>
        ) : (
          <>
            <p>
              {email} ·{" "}
              <Button disabled={working} onClick={onSignOut}>
                {t.signOut}
              </Button>
            </p>
            {error && <p role="alert">{t[error]}</p>}
            {!data && !error && <p role="status">{t.load}</p>}
            {data && "scopes" in data && (
              <>
                <p>
                  <strong>{data.name}</strong> · {t.destination} {data.host}
                </p>
                <p>{t.share}</p>
                {[false, true].map((write) => {
                  const scopes = data.scopes.filter(
                    (scope) => scope.endsWith(":write") === write,
                  );
                  return (
                    scopes.length > 0 && (
                      <fieldset key={String(write)}>
                        <legend>{write ? t.write : t.read}</legend>
                        {scopes.map((scope) => (
                          <label className="connect-scope" key={scope}>
                            <input
                              type="checkbox"
                              checked={selected.includes(scope)}
                              disabled={working}
                              onChange={(e) =>
                                setSelected((current) =>
                                  e.target.checked
                                    ? [...current, scope]
                                    : current.filter((item) => item !== scope),
                                )
                              }
                            />
                            {t[scopeLabels[scope]]}
                          </label>
                        ))}
                      </fieldset>
                    )
                  );
                })}
                <p>{t.revokeNote}</p>
              </>
            )}
            {data && "action" in data && state === "pending" && (
              <ActionDetails data={data} t={t} />
            )}
            {state === "pending" && data && (
              <div className="inline">
                <Button
                  className="primary"
                  disabled={
                    working || (mode === "authorize" && !selected.length)
                  }
                  onClick={() => void decide(true)}
                >
                  {mode === "authorize" ? t.allow : t.approve}
                </Button>
                <Button disabled={working} onClick={() => void decide(false)}>
                  {t.cancel}
                </Button>
              </div>
            )}
            {state !== "pending" && <p role="status">{t[state]}</p>}
          </>
        )}
        <p>
          <a href="/">{t.open}</a>
        </p>
      </section>
    </main>
  );
}

function ActionDetails({ data, t }: { data: Action; t: Messages }) {
  const { input, preview } = data;
  const description = {
    create_topic: t.newTopic,
    complete_review: t.complete,
    reschedule_review: t.reschedule,
  };
  const values: [string, string | number | undefined | null][] = [
    [t.topic, input.title ?? preview.title],
    [t.rating, input.rating ?? input.initialKnowledge],
    [t.importance, input.importance],
    [t.duration, input.duration ?? preview.duration],
    [t.tags, input.tags?.join(", ")],
    [t.notes, input.notes],
    [t.materials, input.materials?.join("\n")],
    [t.previous, preview.previous],
    [t.scheduled, input.scheduledAt],
    [t.timezone, preview.timezone],
  ];
  return (
    <>
      <h2>{description[data.action]}</h2>
      <p>
        {t.client} <strong>{data.application}</strong>
      </p>
      <dl>
        {values
          .filter(([, value]) => value != null && value !== "")
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {!!preview.warnings?.length && (
        <div role="alert">
          <strong>{t.warnings}</strong>
          <ul>
            {preview.warnings.map((warning) => (
              <li key={warning}>
                {t.warningMessages[copy.en.warningMessages.indexOf(warning)] ??
                  warning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
