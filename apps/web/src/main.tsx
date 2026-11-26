import {
  translate,
  systemMessage,
  useLanguage,
  getLanguage,
  setLanguage,
  type MessageKey,
  type Language,
} from "./i18n";
import { LanguageSwitch } from "./i18n/LanguageSwitch";
import { Skeleton } from "./Skeleton";
import { ConnectLoading } from "./connect-ui";
import {
  firebaseAuth,
  usesFirebase,
  observeAuth,
  login,
  signInErrorMessage,
} from "./firebase";
import type { User } from "firebase/auth";
import { connectCalendar } from "./api";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import {
  Archive,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Layers3,
  LogOut,
  Moon,
  RefreshCw,
  RotateCcw,
  Settings2,
  Sun,
} from "lucide-react";
import { DateTime } from "luxon";
import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { defaults } from "../../../packages/shared/src/client.ts";
import { api, setCsrf } from "./api";
import { Logo, Materials } from "./components";
import { initialZone } from "./initial-zone";
import { date } from "./date";

import "./style.css";
import type { Review, Topic } from "./types";
import { Button, Dialog, ErrorContext } from "./ui.tsx";
import { TodayView } from "./views/Today";

import { LegalLinks, LegalPage, legalPath } from "./legal";
import { DeleteAccount } from "./DeleteAccount";
import { Landing, ratingLabels } from "./views/Landing";

const sectionLabels: Record<string, MessageKey> = {
  Today: "today",
  Topics: "topics",
  Calendar: "calendar",
  Settings: "settings",
};
type Notice =
  | string
  | {
      key: "firstReviewSaved" | "completedNext";
      at: string | null;
      zone: string;
    };
type Account = { id: string; display_name: string; email: string };
const sessionTimeoutMs = 20000;
type Dashboard = {
  hasTopics: boolean;
  activeCount: number;
  today: Review[];
  upcoming: Review[];
  prefs: typeof defaults;
  calendar: { connected: boolean; error?: string };
  completed: number;
};
type TopicPage = { items: Topic[]; total: number; nextCursor?: string | null };
type HistoryEntry = {
  id: string;
  schedule_id: string;
  completed_at: string;
  original_rating: number;
  corrected_at?: string;
};
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false } },
});
const CalendarView = lazy(() =>
  import("./views/Calendar").then(({ CalendarView }) => ({
    default: CalendarView,
  })),
);
const TopicsView = lazy(() =>
  import("./views/Topics").then(({ TopicsView }) => ({ default: TopicsView })),
);
const SettingsForm = lazy(() =>
  import("./forms").then(({ SettingsForm }) => ({ default: SettingsForm })),
);
const TopicEditor = lazy(() =>
  import("./forms").then(({ TopicEditor }) => ({ default: TopicEditor })),
);
const Reschedule = lazy(() =>
  import("./forms").then(({ Reschedule }) => ({ default: Reschedule })),
);

async function dashboardData(
  options: { user?: User; signal: AbortSignal },
  readShared: (key: string, path: string) => Promise<any>,
): Promise<Dashboard> {
  const read = (path: string) => api(path, "GET", undefined, options);
  if (usesFirebase) return read("/dashboard");
  const [reviews, prefs, calendar, progress, active]: [
    Review[],
    Dashboard["prefs"],
    Dashboard["calendar"],
    { completed: number },
    TopicPage,
  ] = await Promise.all([
    readShared("calendar", "/reviews/upcoming"),
    readShared("legacy-preferences", "/preferences"),
    readShared("legacy-calendar-status", "/calendar/status"),
    read("/reviews/progress"),
    read("/topics?limit=1"),
  ]);
  const end = DateTime.now().setZone(prefs.timezone).endOf("day").toMillis();
  return {
    prefs,
    calendar,
    completed: progress.completed,
    hasTopics:
      active.total > 0 ||
      reviews.length > 0 ||
      (await read("/topics?limit=1&archived=true")).total > 0,
    activeCount: new Set(reviews.map((r) => r.topic_id)).size,
    today: reviews.filter(
      (r) => r.scheduled_at && Date.parse(r.scheduled_at) <= end,
    ),
    upcoming: reviews
      .filter((r) => !r.scheduled_at || Date.parse(r.scheduled_at) > end)
      .slice(0, 3),
  };
}

const ConnectFlow = lazy(() =>
  import("./ConnectFlow").then(({ ConnectFlow }) => ({ default: ConnectFlow })),
);
const ConnectSettings = lazy(() =>
  import("./Connect").then(({ ConnectSettings }) => ({
    default: ConnectSettings,
  })),
);
const connectFlow =
  location.pathname === "/connect/authorize"
    ? "authorize"
    : location.pathname === "/connect/confirm"
      ? "confirm"
      : null;

function App() {
  const cache = useQueryClient();
  const language = useLanguage();
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [deletionRequested, setDeletionRequested] = useState(false);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = translate("pageTitle");
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", document.title);
  }, [language]);
  const [identity, setIdentity] = useState<User | null>(),
    [profile, setProfile] = useState<{
      identity: User | null | undefined;
      user: Account;
    } | null>(null),
    [sessionAttempt, setSessionAttempt] = useState(0),
    [signingIn, setSigningIn] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState<Notice>("");
  const user = profile?.identity === identity ? profile?.user : null;
  const lifetime = useRef<AbortSignal>(null);
  const session = useRef<AbortSignal>(null);
  const [section, setSection] = useState(
    new URLSearchParams(location.search).get("section") ?? "Today",
  );
  const [query, setQuery] = useState(""),
    [tag, setTag] = useState(""),
    [sort, setSort] = useState("date"),
    [archived, setArchived] = useState(false),
    [dark, setDark] = useState(localStorage.getItem("theme") === "dark");
  const [previewRevision, setPreviewRevision] = useState(0);
  const [createdTopic, setCreatedTopic] = useState<Topic | null>(null);
  const [initialTitle, setInitialTitle] = useState("");
  const [editor, setEditor] = useState<Topic | "new" | null>(null),
    [detail, setDetail] = useState<Topic | null>(null),
    [review, setReview] = useState<Topic | null>(null),
    [reschedule, setReschedule] = useState<Review | null>(null),
    [confirmArchive, setConfirmArchive] = useState<Topic | null>(null),
    [busy, setBusy] = useState(false),
    [correct, setCorrect] = useState<HistoryEntry | null>(null);
  const [calendarMode, setCalendarMode] = useState("week"),
    [anchor, setAnchor] = useState<DateTime | null>(null);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller.signal;
    if (!usesFirebase) return () => controller.abort();

    const onError = () => {
      if (controller.signal.aborted) return;
      clearTimeout(timeout);
      setError("restoreSession");
      setLoading(false);
    };
    const timeout = setTimeout(onError, sessionTimeoutMs);
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = observeAuth((currentUser) => {
        if (controller.signal.aborted) return;
        clearTimeout(timeout);
        setIdentity(currentUser);
      }, onError);
    } catch {
      onError();
    }
    return () => {
      controller.abort();
      clearTimeout(timeout);
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (usesFirebase && identity === undefined) return;
    setProfile(null);
    setSavingLanguage(false);
    cache.removeQueries({ queryKey: ["account"] });
    setQuery("");
    setTag("");
    setArchived(false);
    setSort("date");
    setAnchor(null);
    setSection(new URLSearchParams(location.search).get("section") ?? "Today");
    setBusy(false);
    setCreatedTopic(null);
    setNotice("");
    setShowHoursTip(false);
    setEditor(null);
    setInitialTitle("");
    setDetail(null);
    setReview(null);
    setReschedule(null);
    setConfirmArchive(null);
    setCorrect(null);
    setCsrf("");
    if (usesFirebase && !identity) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    session.current = signal;
    setLoading(true);
    setError("");
    const timeout = setTimeout(() => {
      controller.abort();
      setError("workspaceTimeout");
      setLoading(false);
    }, sessionTimeoutMs);
    api(usesFirebase ? "/me?include=preferences" : "/me", "GET", undefined, {
      user: identity ?? undefined,
      signal,
    })
      .then(async (me) => {
        if (signal.aborted) return;
        if (!me.user) throw new Error("missingProfile");
        setCsrf(me.csrf);
        const options = { user: identity ?? undefined, signal };
        const saved =
          me.preferences ??
          (await api("/preferences", "GET", undefined, options));
        if (signal.aborted) return;
        if (saved.language) setLanguage(saved.language);
        else if (!usesFirebase || saved.onboarded) {
          // Keep the visitor's selected language when they first sign in.
          await api(
            "/preferences/language",
            "PATCH",
            { language: getLanguage() },
            options,
          ).catch(() => {});
          if (signal.aborted) return;
        }
        const tipKey = "study-hours-tip:" + me.user.id;
        if (!saved.onboarded) {
          await api(
            "/preferences",
            "PATCH",
            {
              ...saved,
              language: saved.language ?? getLanguage(),
              timezone: initialZone(saved.timezone, true),
              onboarded: true,
            },
            options,
          );
          if (!signal.aborted) localStorage.setItem(tipKey, "waiting");
        }
        if (signal.aborted) return;
        setShowHoursTip(localStorage.getItem(tipKey) === "visible");
        setProfile({ identity, user: me.user });
      })
      .catch((e) => {
        if (signal.aborted || (!usesFirebase && e.status === 401)) return;
        setError(
          e.status === 401
            ? "expired"
            : e.status === 403
              ? "workspaceDenied"
              : "workspaceError",
        );
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [cache, identity, sessionAttempt]);

  const [showHoursTip, setShowHoursTip] = useState(false);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const accountKey = ["account", user?.id];
  const readOptions = (signal: AbortSignal) => ({
    signal: session.current
      ? AbortSignal.any([signal, session.current])
      : signal,
    user: identity ?? undefined,
  });
  const overview = useQuery({
    queryKey: [...accountKey, "dashboard"],
    queryFn: ({ signal }) =>
      dashboardData(readOptions(signal), (key, path) =>
        cache.fetchQuery({
          queryKey: [...accountKey, key],
          queryFn: ({ signal }) =>
            api(path, "GET", undefined, readOptions(signal)),
        }),
      ),
    enabled: !!user && !connectFlow,
  });
  const dashboard = overview.data;
  const prefs = dashboard?.prefs ?? defaults;
  const calendar = dashboard?.calendar ?? { connected: false };
  const progress = dashboard?.completed ?? 0;
  const calendarReviews = useQuery({
    queryKey: [...accountKey, "calendar"],
    queryFn: ({ signal }): Promise<Review[]> =>
      api("/reviews/upcoming", "GET", undefined, readOptions(signal)),
    enabled: !!user && section === "Calendar" && !connectFlow,
  });
  const topicPages = useInfiniteQuery({
    queryKey: [...accountKey, "topics", archived, sort, search, tag],
    initialPageParam: "" as string | number,
    queryFn: ({ signal, pageParam }): Promise<TopicPage> => {
      const params = new URLSearchParams({
        archived: String(archived),
        sort,
        limit: "30",
      });
      if (search) params.set("q", search);
      if (tag) params.set("tag", tag);
      if (pageParam)
        params.set(usesFirebase ? "cursor" : "offset", String(pageParam));
      return api("/topics?" + params, "GET", undefined, readOptions(signal));
    },
    getNextPageParam: (last, pages) => {
      if (usesFirebase) return last.nextCursor ?? undefined;
      const count = pages.reduce((total, page) => total + page.items.length, 0);
      return last.items.length && count < last.total ? count : undefined;
    },
    enabled: !!user && section === "Topics" && !connectFlow,
  });
  const tagQuery = useQuery({
    queryKey: [...accountKey, "tags"],
    queryFn: ({ signal }): Promise<{ name: string }[]> =>
      api("/tags", "GET", undefined, readOptions(signal)),
    enabled: !!user && (section === "Topics" || !!editor) && !connectFlow,
    staleTime: 120_000,
  });
  const tags = tagQuery.data?.map(({ name }) => name) ?? [];
  const topicHistory = useInfiniteQuery({
    queryKey: [...accountKey, "history", detail?.id],
    initialPageParam: "",
    queryFn: async ({
      signal,
      pageParam,
    }): Promise<{ items: HistoryEntry[]; nextCursor?: string | null }> => {
      const params = new URLSearchParams({ limit: "25" });
      if (pageParam) params.set("cursor", pageParam);
      const suffix = usesFirebase ? "?" + params : "";
      const data = await api(
        "/topics/" + detail!.id + "/history" + suffix,
        "GET",
        undefined,
        readOptions(signal),
      );
      return usesFirebase ? data : { items: data };
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!user && !!detail,
    staleTime: 0,
  });
  const history = topicHistory.data?.pages.flatMap((page) => page.items) ?? [];
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("review");
    if (user && id) {
      const controller = new AbortController();
      const { signal } = controller;
      api("/topics/" + id, "GET", undefined, { signal })
        .then((topic) => {
          if (!signal.aborted) setReview(topic);
        })
        .catch((e) => {
          if (!signal.aborted) setError(e.message);
        });
      historyReplace();
      return () => controller.abort();
    }
  }, [user]);
  function historyReplace() {
    window.history.replaceState(null, "", location.pathname);
  }
  async function signIn() {
    if (signingIn) return;
    const signal = lifetime.current;
    setDeletionRequested(false);
    setSigningIn(true);
    setError("");
    try {
      const signedInUser = await login();
      if (!signal?.aborted && firebaseAuth().currentUser === signedInUser)
        setIdentity(signedInUser);
    } catch (e) {
      if (!signal?.aborted) setError(signInErrorMessage(e));
    } finally {
      if (!signal?.aborted) setSigningIn(false);
    }
  }
  async function action(fn: () => Promise<any>, message: string) {
    const signal = session.current;
    setBusy(true);
    setCreatedTopic(null);
    setNotice("");
    setError("");
    try {
      const result = await fn();
      try {
        if (!result?.signedOut && !signal?.aborted) {
          if (!usesFirebase) {
            const shared = [
              ...(message === "prefsSaved" ? ["legacy-preferences"] : []),
              ...(message === "syncQueued" || message === "calendarDisconnected"
                ? ["legacy-calendar-status"]
                : ["calendar"]),
            ];
            await Promise.all(
              shared.map((key) =>
                cache.invalidateQueries({
                  queryKey: [...accountKey, key],
                  refetchType: "none",
                }),
              ),
            );
          }
          const keys =
            message === "syncQueued" || message === "calendarDisconnected"
              ? ["dashboard"]
              : [
                  "dashboard",
                  "calendar",
                  "topics",
                  "topic",
                  ...(message === "topicUpdated" || message === "added"
                    ? ["tags"]
                    : []),
                  ...(message === "ratingCorrected" ||
                  message === "reviewCompleted"
                    ? ["history"]
                    : []),
                ];
          await Promise.all(
            keys.map((key) =>
              cache.invalidateQueries({ queryKey: [...accountKey, key] }),
            ),
          );
        }
      } finally {
        if (!signal?.aborted)
          setNotice(
            typeof result === "string" || result?.key ? result : message,
          );
      }
    } catch (e: any) {
      if (!signal?.aborted) {
        setError(e.message);
        if (e.status === 409) setPreviewRevision((n) => n + 1);
      }
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }
  function createTopic(
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ) {
    const signal = session.current;
    return action(async () => {
      const topic: Topic = await api("/topics", "POST", input, {
        idempotencyKey,
        signal: signal ?? undefined,
      });
      if (signal?.aborted) return;
      setCreatedTopic(topic);
      setEditor(null);
      setInitialTitle("");
      const at = topic.schedule?.scheduled_at;
      return at
        ? { key: "firstReviewSaved", at, zone: prefs.timezone }
        : "addedNoSlot";
    }, "added");
  }
  function signOut() {
    return action(async () => {
      await api("/auth/logout", "POST");
      cache.removeQueries({ queryKey: accountKey });
      if (!usesFirebase && !lifetime.current?.aborted) setProfile(null);
      return { signedOut: true };
    }, "signedOut");
  }
  const latestTopicRequest = useRef(0);
  async function openTopic(id: string, asReview = false) {
    const signal = session.current ?? undefined;
    const sequence = ++latestTopicRequest.current;
    const path = "/topics/" + id;
    try {
      const topic: Topic = await cache.fetchQuery({
        queryKey: [...accountKey, "topic", id],
        queryFn: ({ signal }) =>
          api(path, "GET", undefined, readOptions(signal)),
        staleTime: 0,
      });
      if (signal?.aborted || sequence !== latestTopicRequest.current) return;
      if (asReview) setReview(topic);
      else setDetail(topic);
    } catch (e: any) {
      if (!signal?.aborted && sequence === latestTopicRequest.current)
        setError(e.message);
    }
  }
  const now = DateTime.now().setZone(prefs.timezone);
  const today = dashboard?.today ?? [];
  const upcoming = dashboard?.upcoming ?? [];
  const filtered = topicPages.data?.pages.flatMap((page) => page.items) ?? [];
  async function chooseLanguage(next: Language) {
    setLanguage(next);
    if (!user) return;
    const signal = session.current;
    setSavingLanguage(true);
    setError((current) => (current === "languageSync" ? "" : current));
    try {
      await api(
        "/preferences/language",
        "PATCH",
        { language: next },
        {
          signal: signal ?? undefined,
          user: identity ?? undefined,
        },
      );
    } catch {
      if (!signal?.aborted) setError("languageSync");
    } finally {
      if (!signal?.aborted) setSavingLanguage(false);
    }
  }
  if (usesFirebase && connectFlow)
    return (
      <Suspense
        fallback={
          <main className="connect-flow">
            <ConnectLoading />
          </main>
        }
      >
        <ConnectFlow
          key={user?.id ?? "signed-out"}
          mode={connectFlow}
          accountId={user?.id}
          identity={identity ?? undefined}
          email={user?.email}
          loading={loading}
          signingIn={signingIn}
          error={error}
          dark={dark}
          savingLanguage={savingLanguage}
          onLanguageChange={chooseLanguage}
          onToggleTheme={() => setDark((previous) => !previous)}
          onSignIn={signIn}
          onSignOut={signOut}
          onRetrySignIn={() => setSessionAttempt((attempt) => attempt + 1)}
        />
      </Suspense>
    );
  if (loading)
    return (
      <div className="center-screen">
        <img
          className="brand-mark"
          src="/favicon.svg"
          width="38"
          height="38"
          alt=""
        />
        <Skeleton section={section} account />
      </div>
    );
  if (!user || deletionRequested)
    return (
      <Landing
        theme={
          <Button
            className="icon-button"
            onClick={() => setDark(!dark)}
            aria-label={translate("theme")}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
        }
        cta={
          usesFirebase ? (
            <Button className="primary" disabled={signingIn} onClick={signIn}>
              <img
                className="google-g"
                src="/google-g.png"
                width="20"
                height="20"
                alt=""
              />
              {signingIn ? translate("signingIn") : translate("signIn")}
            </Button>
          ) : (
            <a className="button primary" href="/api/v1/auth/google/start">
              <img
                className="google-g"
                src="/google-g.png"
                width="20"
                height="20"
                alt=""
              />
              {translate("signIn")}
            </a>
          )
        }
        feedback={
          <>
            {deletionRequested && (
              <p role="status">{translate("deleteAccountRequested")}</p>
            )}
            {error && <p role="alert">{systemMessage(error)}</p>}
            {identity && error && (
              <Button
                onClick={() => setSessionAttempt((attempt) => attempt + 1)}
                disabled={signingIn}
              >
                {translate("retryWorkspace")}
              </Button>
            )}
          </>
        }
      />
    );
  return (
    <ErrorContext.Provider value={systemMessage(error)}>
      <div className="shell">
        <aside>
          <Logo />
          <div className="workspace-label">{translate("workspace")}</div>
          <nav>
            {[
              ["Today", Sun],
              ["Topics", Layers3],
              ["Calendar", CalendarDays],
              ["Settings", Settings2],
            ].map(([label, Icon]: any) => (
              <button
                key={label}
                className={section === label ? "nav-item selected" : "nav-item"}
                onClick={() => setSection(label)}
              >
                <Icon size={20} />
                {translate(sectionLabels[label])}
                {label === "Today" && today.length > 0 && (
                  <span className="nav-count">{today.length}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="account">
              <div className="avatar">{user.display_name[0]}</div>
              <div>
                <strong>{user.display_name}</strong>
                <small>{translate("personalWorkspace")}</small>
              </div>
              <Button
                className="icon-button"
                aria-label={translate("logout")}
                disabled={busy}
                onClick={signOut}
              >
                <LogOut size={16} />
              </Button>
            </div>
          </div>
        </aside>
        <div className="main-wrap">
          <header className="topbar">
            <span>
              Blind Spot <span className="muted">/</span>{" "}
              <strong>{translate(sectionLabels[section] ?? "today")}</strong>
            </span>
            <div className="top-actions">
              <LanguageSwitch
                disabled={savingLanguage}
                onSelect={chooseLanguage}
              />
              <Button
                className="icon-button"
                aria-label={translate("refreshWorkspace")}
                title={translate("refreshWorkspace")}
                disabled={busy || overview.isFetching}
                onClick={() =>
                  void cache.invalidateQueries({ queryKey: accountKey })
                }
              >
                <RefreshCw size={17} />
              </Button>
              <span className="today-date">
                {now.setLocale(language).toFormat("cccc, d MMMM")}
              </span>
              <Button
                className="icon-button"
                onClick={() => setDark(!dark)}
                aria-label={translate("theme")}
              >
                {dark ? <Sun size={19} /> : <Moon size={19} />}
              </Button>
            </div>
          </header>
          <main
            className={
              section === "Settings" ? "content settings-content" : "content"
            }
          >
            {error && (
              <div className="banner error" role="alert">
                {systemMessage(error)}
                <button onClick={() => setError("")}>
                  {translate("dismiss")}
                </button>
              </div>
            )}
            {showHoursTip && (
              <div className="banner">
                <span>
                  {translate("hoursTip")}{" "}
                  <a
                    href="?section=Settings"
                    onClick={(e) => {
                      e.preventDefault();
                      setSection("Settings");
                    }}
                  >
                    {translate("settings")}
                  </a>
                  .
                </span>
                <button
                  onClick={() => {
                    localStorage.removeItem("study-hours-tip:" + user.id);
                    setShowHoursTip(false);
                  }}
                >
                  {translate("dismiss")}
                </button>
              </div>
            )}
            {notice && (
              <div className="banner success" role="status">
                <span>
                  {typeof notice === "string"
                    ? systemMessage(notice)
                    : translate(notice.key, {
                        date: date(notice.at, notice.zone),
                      })}
                </span>
                {createdTopic &&
                  (createdTopic.schedule?.scheduled_at ? (
                    <Button onClick={() => openTopic(createdTopic.id)}>
                      {translate("viewTopic")}
                    </Button>
                  ) : (
                    <Button
                      onClick={() =>
                        createdTopic.schedule
                          ? setReschedule({
                              ...createdTopic.schedule,
                              title: createdTopic.title,
                            })
                          : openTopic(createdTopic.id)
                      }
                    >
                      {translate("chooseTime")}
                    </Button>
                  ))}
                <button onClick={() => setNotice("")}>
                  {translate("dismiss")}
                </button>
              </div>
            )}
            {!dashboard &&
              (overview.isError ? (
                <Button onClick={() => void overview.refetch()}>
                  {translate("retryWorkspace")}
                </Button>
              ) : (
                <Skeleton section={section} />
              ))}
            {dashboard && section === "Today" && (
              <TodayView
                upcoming={upcoming}
                activeCount={dashboard.activeCount}
                hasTopics={dashboard.hasTopics}
                busy={busy}
                onCreate={(title) => {
                  setInitialTitle(title);
                  setEditor("new");
                }}
                today={today}
                prefs={prefs}
                progress={progress}
                openTopic={openTopic}
                setEditor={setEditor}
                setSection={setSection}
              />
            )}
            {dashboard && section === "Topics" && (
              <Suspense fallback={<Skeleton section="Topics" />}>
                <TopicsView
                  filtered={filtered}
                  loading={topicPages.isPending}
                  loadFailed={topicPages.isError}
                  retry={() => void topicPages.refetch()}
                  hasMore={topicPages.hasNextPage}
                  loadingMore={topicPages.isFetchingNextPage}
                  loadMore={() => void topicPages.fetchNextPage()}
                  tags={tags}
                  query={query}
                  setQuery={setQuery}
                  tag={tag}
                  setTag={setTag}
                  sort={sort}
                  setSort={setSort}
                  archived={archived}
                  setArchived={setArchived}
                  setEditor={setEditor}
                  openTopic={openTopic}
                  prefs={prefs}
                />
              </Suspense>
            )}
            {dashboard && section === "Calendar" && (
              <Suspense fallback={<Skeleton section="Calendar" />}>
                {calendarReviews.isPending ? (
                  <Skeleton section="Calendar" />
                ) : calendarReviews.isError ? (
                  <Button onClick={() => void calendarReviews.refetch()}>
                    {translate("retry")}
                  </Button>
                ) : (
                  <CalendarView
                    onError={setError}
                    prefs={prefs}
                    calendar={calendar}
                    setEditor={setEditor}
                    calendarMode={calendarMode}
                    setCalendarMode={setCalendarMode}
                    anchor={
                      anchor?.setZone(prefs.timezone).startOf("day") ??
                      now.startOf("day")
                    }
                    setAnchor={setAnchor}
                    now={now}
                    reviews={calendarReviews.data ?? []}
                    setReschedule={setReschedule}
                  />
                )}
              </Suspense>
            )}
            {dashboard && section === "Settings" && (
              <>
                <div className="page-heading">
                  <div>
                    <h1>{translate("settings")}</h1>
                  </div>
                </div>
                <div className="settings-layout">
                  <Suspense fallback={<Skeleton section="Settings" />}>
                    <SettingsForm
                      prefs={prefs}
                      busy={busy}
                      onSave={(p) =>
                        action(
                          () => api("/preferences", "PATCH", p),
                          "prefsSaved",
                        )
                      }
                    />
                  </Suspense>
                  <div className="settings-secondary">
                    <div className="settings-card">
                      <h2>{translate("googleCalendar")}</h2>
                      <p>
                        {calendar.connected
                          ? translate("connectedInfo")
                          : translate("disconnectedInfo")}
                      </p>
                      {calendar.error && (
                        <p role="alert">{systemMessage(calendar.error)}</p>
                      )}
                      <div className="inline">
                        {calendar.connected ? (
                          <>
                            <Button
                              onClick={() =>
                                action(
                                  () => api("/calendar/resync", "POST"),
                                  "syncQueued",
                                )
                              }
                            >
                              {translate("resync")}
                            </Button>
                            <Button
                              onClick={() =>
                                action(
                                  () => api("/calendar/disconnect", "POST"),
                                  "calendarDisconnected",
                                )
                              }
                            >
                              {translate("disconnect")}
                            </Button>
                          </>
                        ) : (
                          <a
                            className="button"
                            href="/api/v1/calendar/connect"
                            onClick={(e) => {
                              e.preventDefault();
                              connectCalendar().catch((e) =>
                                setError(e.message),
                              );
                            }}
                          >
                            {translate("connectCalendar")}{" "}
                            <ArrowUpRight size={16} />
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="settings-card">
                      <h2>{translate("account")}</h2>
                      <p>
                        {user.display_name} · {user.email}
                      </p>
                      <Button disabled={busy} onClick={signOut}>
                        {translate("signOut")}
                      </Button>
                      {usesFirebase && identity && (
                        <DeleteAccount
                          user={identity}
                          onRequested={() => {
                            setDeletionRequested(true);
                            signOut();
                          }}
                        />
                      )}
                      <LegalLinks />
                    </div>
                  </div>
                  {usesFirebase && (
                    <Suspense
                      fallback={
                        <div className="settings-card connect-settings">
                          <ConnectLoading grid />
                        </div>
                      }
                    >
                      <ConnectSettings
                        key={user.id}
                        accountId={user.id}
                        identity={identity ?? undefined}
                      />
                    </Suspense>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
        {editor && (
          <Suspense fallback={<Skeleton section="Topics" compact />}>
            <TopicEditor
              initialTitle={initialTitle}
              revision={previewRevision}
              topic={editor === "new" ? null : editor}
              prefs={prefs}
              busy={busy}
              tags={tags}
              onClose={() => {
                setEditor(null);
                setInitialTitle("");
              }}
              onSave={(input, key) =>
                editor === "new"
                  ? createTopic(input, key)
                  : action(async () => {
                      await api("/topics/" + editor.id, "PATCH", input);
                      setEditor(null);
                      setDetail(null);
                    }, "topicUpdated")
              }
            />
          </Suspense>
        )}
        {detail && (
          <Dialog
            description={translate("topicDetails")}
            title={detail.title}
            onClose={() => setDetail(null)}
          >
            <div className="tags">
              {detail.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <dl className="detail-grid">
              <dt>{translate("targetRecall")}</dt>
              <dd>{Math.round(detail.target_retention * 100)}%</dd>
              <dt>{translate("knowledgeQuestion")}</dt>
              <dd>{detail.initial_knowledge ?? translate("notSet")}</dd>
              <dt>{translate("importance")}</dt>
              <dd>{detail.importance ?? translate("notSet")}</dd>
              <dt>{translate("nextReview")}</dt>
              <dd>
                {date(detail.schedule?.scheduled_at ?? null, prefs.timezone)}
              </dd>
              <dt>{translate("scheduling")}</dt>
              <dd>
                {detail.schedule
                  ? translate(
                      detail.schedule.mode === "manual"
                        ? "manual"
                        : "automatic",
                    )
                  : translate(
                      detail.status === "active" ? "active" : "archived",
                    )}
              </dd>
            </dl>
            {detail.schedule?.adjustment_reason && (
              <p className="banner">
                {systemMessage(detail.schedule.adjustment_reason)}
              </p>
            )}
            <Materials items={detail.materials} />
            <div className="inline wrap">
              <Button
                className="primary"
                disabled={!detail.schedule}
                onClick={() => {
                  setReview(detail);
                  setDetail(null);
                }}
              >
                {translate("reviewNow")} <ArrowRight size={16} />
              </Button>
              <Button
                onClick={() => {
                  setEditor(detail);
                  setDetail(null);
                }}
              >
                {translate("editTopic")}
              </Button>
              {detail.schedule && (
                <Button
                  onClick={() =>
                    setReschedule({ ...detail.schedule!, title: detail.title })
                  }
                >
                  {translate("reschedule")}
                </Button>
              )}
              <Button onClick={() => setConfirmArchive(detail)}>
                {detail.status === "archived" ? (
                  <RotateCcw size={16} />
                ) : (
                  <Archive size={16} />
                )}{" "}
                {detail.status === "archived"
                  ? translate("restore")
                  : translate("archive")}
              </Button>
            </div>
            <h3 className="history-heading">{translate("reviewHistory")}</h3>
            {topicHistory.isPending ? (
              <p className="muted">{translate("loadingHistory")}</p>
            ) : topicHistory.isError && !history.length ? (
              <Button onClick={() => void topicHistory.refetch()}>
                {translate("retry")}
              </Button>
            ) : history.length ? (
              history.map((h, index) => (
                <div className="history-row" key={h.id}>
                  <span>
                    {date(h.completed_at, prefs.timezone)} · {h.original_rating}
                    /5
                    {h.corrected_at ? translate("corrected") : ""}
                  </span>
                  {(usesFirebase
                    ? h.schedule_id === detail.memory?.latestReviewId
                    : index === 0) &&
                    detail.status === "active" &&
                    detail.schedule?.mode !== "manual" && (
                      <Button
                        onClick={() => {
                          setCorrect(h);
                          setDetail(null);
                        }}
                      >
                        {translate("correctRating")}
                      </Button>
                    )}
                </div>
              ))
            ) : (
              <p className="muted">{translate("noHistory")}</p>
            )}
            {topicHistory.hasNextPage && (
              <Button
                disabled={topicHistory.isFetchingNextPage}
                onClick={() => void topicHistory.fetchNextPage()}
              >
                {translate(
                  topicHistory.isFetchNextPageError
                    ? "retry"
                    : topicHistory.isFetchingNextPage
                      ? "loadingHistory"
                      : "loadMore",
                )}
              </Button>
            )}
          </Dialog>
        )}
        {review && (
          <Dialog
            title={review.title}
            description={translate("recallPrompt")}
            onClose={() => setReview(null)}
          >
            {review.materials.length > 0 && (
              <details>
                <summary>{translate("showNotes")}</summary>
                <Materials items={review.materials} />
              </details>
            )}
            <h3>{translate("rateRecall")}</h3>
            <p className="muted">{translate("ratingSaves")}</p>
            {review.schedule ? (
              <div className="rating-options">
                {ratingLabels.map((label, i) => (
                  <Button
                    key={label}
                    disabled={busy}
                    onClick={() =>
                      action(async () => {
                        const signal = session.current;
                        const r = await api(
                          "/reviews/" + review.schedule!.id + "/complete",
                          "POST",
                          { rating: i + 1 },
                        );
                        if (signal?.aborted) return;
                        const tipKey = "study-hours-tip:" + user.id;
                        if (localStorage.getItem(tipKey) === "waiting") {
                          localStorage.setItem(tipKey, "visible");
                          setShowHoursTip(true);
                        }
                        setReview(null);
                        if (r.next?.scheduled_at)
                          setAnchor(
                            DateTime.fromISO(r.next.scheduled_at)
                              .setZone(prefs.timezone)
                              .startOf("day"),
                          );
                        if (r.next && !r.next.scheduled_at)
                          return r.next.adjustment_reason ?? "needsTime";
                        return {
                          key: "completedNext",
                          at: r.next?.scheduled_at ?? null,
                          zone: prefs.timezone,
                        };
                      }, "reviewCompleted")
                    }
                  >
                    <span>{i + 1}</span>
                    {translate(label)}
                    <ArrowRight size={16} />
                  </Button>
                ))}
              </div>
            ) : (
              <p>{translate("noPending")}</p>
            )}
          </Dialog>
        )}
        {correct && (
          <Dialog
            title={translate("correctDialog")}
            description={translate("correctInfo")}
            onClose={() => setCorrect(null)}
          >
            <div className="rating-options">
              {[1, 2, 3, 4, 5].map((r) => (
                <Button
                  key={r}
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await api(
                        "/reviews/" + correct.schedule_id + "/correct",
                        "POST",
                        { rating: r },
                      );
                      setCorrect(null);
                    }, "ratingCorrected")
                  }
                >
                  {r} / 5
                </Button>
              ))}
            </div>
          </Dialog>
        )}
        {reschedule && (
          <Suspense fallback={<Skeleton section="Calendar" compact />}>
            <Reschedule
              review={reschedule}
              zone={prefs.timezone}
              busy={busy}
              onClose={() => setReschedule(null)}
              onSave={(at) =>
                action(
                  async () => {
                    await api(
                      "/reviews/" +
                        reschedule.id +
                        (at ? "/schedule" : "/reset-auto"),
                      at ? "PATCH" : "POST",
                      at ? { scheduledAt: at } : {},
                    );
                    setReschedule(null);
                    setDetail(null);
                  },
                  at ? "manualSaved" : "autoRestored",
                )
              }
            />
          </Suspense>
        )}
        {confirmArchive && (
          <Dialog
            title={
              confirmArchive.status === "archived"
                ? translate("restoreDialog")
                : translate("archiveDialog")
            }
            description={translate("historyPreserved")}
            onClose={() => setConfirmArchive(null)}
          >
            <p>
              {confirmArchive.status === "archived"
                ? translate("restoreInfo")
                : translate("archiveInfo")}
            </p>
            <Button
              className="primary"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await api(
                    "/topics/" +
                      confirmArchive.id +
                      (confirmArchive.status === "archived"
                        ? "/restore"
                        : "/archive"),
                    "POST",
                  );
                  setConfirmArchive(null);
                  setDetail(null);
                }, "topicUpdated")
              }
            >
              {translate(
                confirmArchive.status === "archived"
                  ? "confirmRestore"
                  : "confirmArchive",
              )}
            </Button>
          </Dialog>
        )}
      </div>
    </ErrorContext.Provider>
  );
}

const publicPath = legalPath(location.pathname);
const root = createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {publicPath ? <LegalPage path={publicPath} /> : <App />}
    </QueryClientProvider>
  </React.StrictMode>,
);
