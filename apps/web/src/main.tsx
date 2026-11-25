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
  Mail,
  Moon,
  RotateCcw,
  Send,
  Settings2,
  Sun,
} from "lucide-react";
import { DateTime } from "luxon";
import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { defaults } from "../../../packages/shared/src/index.ts";
import { api, setCsrf, loadTopics } from "./api";
import { Logo, Materials } from "./components";
import { date } from "./date";
import { Reschedule, SettingsForm, TopicEditor } from "./forms";

import "./style.css";
import type { Review, Topic } from "./types";
import { Button, Dialog, ErrorContext } from "./ui.tsx";
import { CalendarView } from "./views/Calendar";
import { TodayView } from "./views/Today";
import { TopicsView } from "./views/Topics";

type Account = { id: string; display_name: string; email: string };
const sessionTimeoutMs = 20000;
const emptyDashboard = {
  topics: [] as Topic[],
  reviews: [] as Review[],
  prefs: defaults,
  calendar: { connected: false } as { connected: boolean; error?: string },
  progress: 0,
};

const ConnectFlow = lazy(() =>
  import("./Connect").then(({ ConnectFlow }) => ({ default: ConnectFlow })),
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
  const [identity, setIdentity] = useState<User | null>(),
    [profile, setProfile] = useState<{
      identity: User | null | undefined;
      user: Account;
    } | null>(null),
    [sessionAttempt, setSessionAttempt] = useState(0),
    [signingIn, setSigningIn] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const user = profile?.identity === identity ? profile?.user : null;
  const lifetime = useRef<AbortSignal>(null);
  const session = useRef<AbortSignal>(null);
  const [section, setSection] = useState(
      new URLSearchParams(location.search).get("section") ?? "Today",
    ),
    [dashboard, setDashboard] = useState(emptyDashboard);
  const { topics, reviews, prefs, calendar, progress } = dashboard;
  const [query, setQuery] = useState(""),
    [tag, setTag] = useState(""),
    [sort, setSort] = useState("date"),
    [archived, setArchived] = useState(false),
    [dark, setDark] = useState(localStorage.getItem("theme") === "dark");
  const [editor, setEditor] = useState<Topic | "new" | null>(null),
    [detail, setDetail] = useState<Topic | null>(null),
    [review, setReview] = useState<Topic | null>(null),
    [history, setHistory] = useState<any[]>([]),
    [reschedule, setReschedule] = useState<Review | null>(null),
    [confirmArchive, setConfirmArchive] = useState<Topic | null>(null),
    [busy, setBusy] = useState(false),
    [correct, setCorrect] = useState<any>(null);
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
      setError("Could not restore your sign-in session. Try signing in again.");
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
    setDashboard(emptyDashboard);
    setBusy(false);
    setNotice("");
    setEditor(null);
    setDetail(null);
    setReview(null);
    setHistory([]);
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
      setError("Loading your workspace timed out. Try again.");
      setLoading(false);
    }, sessionTimeoutMs);
    api("/me", "GET", undefined, { user: identity ?? undefined, signal })
      .then((me) => {
        if (signal.aborted) return;
        if (!me.user) throw new Error("Workspace profile is missing");
        setCsrf(me.csrf);
        setProfile({ identity, user: me.user });
      })
      .catch((e) => {
        if (signal.aborted || (!usesFirebase && e.status === 401)) return;
        setError(
          e.status === 401
            ? "Your session expired. Sign in with Google again."
            : e.status === 403
              ? "Your account could not load the workspace. Sign in with Google again."
              : "Could not load your workspace. Try again.",
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
  }, [identity, sessionAttempt]);

  const latestRefresh = useRef(0);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const sequence = ++latestRefresh.current;
      const [ts, reviews, prefs, calendar, progress] = await Promise.all([
        loadTopics(archived, sort, signal),
        api("/reviews/upcoming", "GET", undefined, { signal }),
        api("/preferences", "GET", undefined, { signal }),
        api("/calendar/status", "GET", undefined, { signal }),
        api("/reviews/progress", "GET", undefined, { signal }),
      ]);
      if (signal?.aborted || sequence !== latestRefresh.current) return;
      setDashboard({
        topics: ts.items,
        reviews,
        prefs,
        calendar,
        progress: progress.completed,
      });
    },
    [archived, sort],
  );
  useEffect(() => {
    if (!user || connectFlow) return;
    const controller = new AbortController();
    refresh(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [user, refresh]);
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
    setNotice("");
    setError("");
    try {
      const result = await fn();
      if (!result?.signedOut && !signal?.aborted)
        await refresh(signal ?? undefined);
      if (!signal?.aborted)
        setNotice(typeof result === "string" ? result : message);
    } catch (e: any) {
      if (!signal?.aborted) setError(e.message);
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }
  function signOut() {
    return action(async () => {
      await api("/auth/logout", "POST");
      if (!usesFirebase && !lifetime.current?.aborted) setProfile(null);
      return { signedOut: true };
    }, "Signed out");
  }
  const latestTopicRequest = useRef(0);
  async function openTopic(id: string, asReview = false) {
    const signal = session.current ?? undefined;
    const sequence = ++latestTopicRequest.current;
    const path = "/topics/" + id;
    try {
      const [topic, entries] = await Promise.all([
        api(path, "GET", undefined, { signal }),
        asReview ? [] : api(path + "/history", "GET", undefined, { signal }),
      ]);
      if (signal?.aborted || sequence !== latestTopicRequest.current) return;
      if (asReview) setReview(topic);
      else {
        setHistory(entries);
        setDetail(topic);
      }
    } catch (e: any) {
      if (!signal?.aborted && sequence === latestTopicRequest.current)
        setError(e.message);
    }
  }
  const now = DateTime.now().setZone(prefs.timezone),
    today = reviews.filter(
      (r) =>
        r.scheduled_at &&
        DateTime.fromISO(r.scheduled_at).setZone(prefs.timezone) <=
          now.endOf("day"),
    );
  const filtered = topics.filter(
    (t) =>
      t.title.toLowerCase().includes(query.toLowerCase()) &&
      (!tag || t.tags.includes(tag)),
  );
  const tags = [...new Set(topics.flatMap((t) => t.tags))].sort();
  if (usesFirebase && connectFlow)
    return (
      <Suspense fallback={null}>
        <ConnectFlow
          mode={connectFlow}
          email={user?.email}
          loading={loading}
          signingIn={signingIn}
          error={!!error}
          onSignIn={signIn}
          onSignOut={signOut}
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
        <p role="status">Finding your rhythm…</p>
      </div>
    );
  if (!user)
    return (
      <div className="landing">
        <header>
          <Logo />
          <Button
            className="icon-button"
            onClick={() => setDark(!dark)}
            aria-label="Toggle theme"
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
        </header>
        <main className="landing-grid">
          <div>
            <p className="eyebrow">LESS FORGETTING. MORE BECOMING.</p>
            <h1>
              You learned it.
              <br />
              Now make it <em>stay.</em>
            </h1>
            <p className="intro">
              A little review, at just the right time. Give your knowledge a
              place to grow with a schedule that adapts to you.
            </p>
            {usesFirebase ? (
              <Button className="primary" disabled={signingIn} onClick={signIn}>
                <img
                  className="google-g"
                  src="/google-g.png"
                  width="20"
                  height="20"
                  alt=""
                />
                {signingIn ? "Opening Google Sign-In…" : "Continue with Google"}
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
                Continue with Google
              </a>
            )}
            <p className="fine-print">
              Your calendar is optional. Your potential isn’t.
            </p>
            {error && <p role="alert">{error}</p>}
            {identity && error && (
              <Button
                onClick={() => setSessionAttempt((attempt) => attempt + 1)}
                disabled={signingIn}
              >
                Retry loading workspace
              </Button>
            )}
          </div>
          <div className="orbit-art" aria-hidden="true">
            <div className="orbit one" />
            <div className="orbit two" />
            <div className="orbit three" />
            <div className="orbit-center">
              make
              <br />
              it stay
              <ArrowUpRight aria-hidden="true" />
            </div>
            <span className="floating-label">
              A SMALL HABIT. A LASTING DIFFERENCE.
            </span>
          </div>
        </main>
        <footer>
          <small>BLIND SPOT INTERVAL © 2026</small>
          <address aria-label="Contact">
            <a
              href="https://t.me/aabdunazirov"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Send size={15} aria-hidden="true" />
              <span>
                <span className="sr-only">Telegram: </span>@aabdunazirov
              </span>
            </a>
            <a href="mailto:abdulatifabdunazirov@gmail.com">
              <Mail size={15} aria-hidden="true" />
              <span>
                <span className="sr-only">Email: </span>
                abdulatifabdunazirov@gmail.com
              </span>
            </a>
          </address>
        </footer>
      </div>
    );
  return (
    <ErrorContext.Provider value={error}>
      <div className="shell">
        <aside>
          <Logo />
          <div className="workspace-label">YOUR LEARNING SPACE</div>
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
                {label}
                {label === "Today" && today.length > 0 && (
                  <span className="nav-count">{today.length}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-note">
              <span className="tiny-star">✳</span>
              <p>
                Little by little.
                <br />
                <strong>It adds up.</strong>
              </p>
            </div>
            <div className="account">
              <div className="avatar">{user.display_name[0]}</div>
              <div>
                <strong>{user.display_name}</strong>
                <small>Your personal workspace</small>
              </div>
              <Button
                className="icon-button"
                aria-label="Log out"
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
              <strong>{section}</strong>
            </span>
            <div className="top-actions">
              <span className="today-date">{now.toFormat("cccc, d LLLL")}</span>
              <Button
                className="icon-button"
                onClick={() => setDark(!dark)}
                aria-label="Toggle theme"
              >
                {dark ? <Sun size={19} /> : <Moon size={19} />}
              </Button>
            </div>
          </header>
          <main className="content">
            {error && (
              <div className="banner error" role="alert">
                {error}
                <button onClick={() => setError("")}>Dismiss</button>
              </div>
            )}
            {notice && (
              <div className="banner success" role="status">
                {notice}
                <button onClick={() => setNotice("")}>Dismiss</button>
              </div>
            )}
            {section === "Today" && (
              <TodayView
                reviews={reviews}
                today={today}
                prefs={prefs}
                progress={progress}
                openTopic={openTopic}
                setEditor={setEditor}
                setSection={setSection}
              />
            )}
            {section === "Topics" && (
              <TopicsView
                filtered={filtered}
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
            )}
            {section === "Calendar" && (
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
                reviews={reviews}
                setReschedule={setReschedule}
              />
            )}
            {section === "Settings" && (
              <>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">MAKE IT YOURS</p>
                    <h1>Your pace. Your preferences.</h1>
                    <p className="subtitle">A schedule that fits your life.</p>
                  </div>
                </div>
                <SettingsForm
                  prefs={prefs}
                  busy={busy}
                  onSave={(p) =>
                    action(
                      () => api("/preferences", "PATCH", p),
                      "Preferences saved",
                    )
                  }
                />
                <div className="settings-card">
                  <h2>Google Calendar</h2>
                  <p>
                    {calendar.connected
                      ? "Connected. Automatic sync runs in the background."
                      : "Optional. Internal scheduling works without connecting."}
                  </p>
                  {calendar.error && <p role="alert">{calendar.error}</p>}
                  <div className="inline">
                    {calendar.connected ? (
                      <>
                        <Button
                          onClick={() =>
                            action(
                              () => api("/calendar/resync", "POST"),
                              "Calendar reconciliation queued",
                            )
                          }
                        >
                          Resync
                        </Button>
                        <Button
                          onClick={() =>
                            action(
                              () => api("/calendar/disconnect", "POST"),
                              "Calendar disconnected. Internal reviews are preserved.",
                            )
                          }
                        >
                          Disconnect
                        </Button>
                      </>
                    ) : (
                      <a
                        className="button"
                        href="/api/v1/calendar/connect"
                        onClick={(e) => {
                          e.preventDefault();
                          connectCalendar().catch((e) => setError(e.message));
                        }}
                      >
                        Connect Google Calendar <ArrowUpRight size={16} />
                      </a>
                    )}
                  </div>
                </div>
                {usesFirebase && (
                  <Suspense fallback={null}>
                    <ConnectSettings key={user.id} />
                  </Suspense>
                )}
                <div className="settings-card">
                  <h2>Account</h2>
                  <p>
                    {user.display_name} · {user.email}
                  </p>
                  <Button disabled={busy} onClick={signOut}>
                    Sign out
                  </Button>
                </div>
              </>
            )}
            <footer className="content-footer">
              <span>GOOD THINGS TAKE REPETITION.</span>
              <span className="inline">
                Blind Spot Interval <ArrowUpRight size={10} />
              </span>
            </footer>
          </main>
        </div>
        {editor && (
          <TopicEditor
            topic={editor === "new" ? null : editor}
            prefs={prefs}
            busy={busy}
            tags={tags}
            onClose={() => setEditor(null)}
            onSave={(input) =>
              action(
                async () => {
                  await api(
                    "/topics" + (editor === "new" ? "" : "/" + editor.id),
                    editor === "new" ? "POST" : "PATCH",
                    input,
                  );
                  setEditor(null);
                  setDetail(null);
                },
                editor === "new"
                  ? "Topic added. Let’s make it stay."
                  : "Topic updated",
              )
            }
          />
        )}
        {detail && (
          <Dialog title={detail.title} onClose={() => setDetail(null)}>
            <div className="tags">
              {detail.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <dl className="detail-grid">
              <dt>Target retention</dt>
              <dd>{Math.round(detail.target_retention * 100)}%</dd>
              <dt>Initial knowledge</dt>
              <dd>{detail.initial_knowledge ?? "Not set"}</dd>
              <dt>Importance</dt>
              <dd>{detail.importance ?? "Not set"}</dd>
              <dt>Ideal review</dt>
              <dd>
                {date(detail.schedule?.ideal_due_at ?? null, prefs.timezone)}
              </dd>
              <dt>Scheduled review</dt>
              <dd>
                {date(detail.schedule?.scheduled_at ?? null, prefs.timezone)}
              </dd>
              <dt>Scheduling</dt>
              <dd>{detail.schedule?.mode ?? detail.status}</dd>
            </dl>
            {detail.schedule?.adjustment_reason && (
              <p className="banner">{detail.schedule.adjustment_reason}</p>
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
                Review now <ArrowRight size={16} />
              </Button>
              <Button
                onClick={() => {
                  setEditor(detail);
                  setDetail(null);
                }}
              >
                Edit topic
              </Button>
              {detail.schedule && (
                <Button
                  onClick={() =>
                    setReschedule({ ...detail.schedule!, title: detail.title })
                  }
                >
                  Reschedule
                </Button>
              )}
              <Button onClick={() => setConfirmArchive(detail)}>
                {detail.status === "archived" ? (
                  <RotateCcw size={16} />
                ) : (
                  <Archive size={16} />
                )}{" "}
                {detail.status === "archived" ? "Restore" : "Archive"}
              </Button>
            </div>
            <h3 className="history-heading">Review history</h3>
            {history.length ? (
              history.map((h, index) => (
                <div className="history-row" key={h.id}>
                  <span>
                    {date(h.completed_at, prefs.timezone)} · {h.original_rating}
                    /5
                    {h.corrected_at ? " (corrected)" : ""}
                  </span>
                  {index === 0 &&
                    detail.status === "active" &&
                    detail.schedule?.mode !== "manual" && (
                      <Button
                        onClick={() => {
                          setCorrect(h);
                          setDetail(null);
                        }}
                      >
                        Correct rating
                      </Button>
                    )}
                </div>
              ))
            ) : (
              <p className="muted">
                No reviews yet. Your initial knowledge is a starting estimate.
              </p>
            )}
          </Dialog>
        )}
        {review && (
          <Dialog
            title={review.title}
            description="Recall first. Then check your notes."
            onClose={() => setReview(null)}
          >
            <Materials items={review.materials} />
            <h3>How well did you remember this topic?</h3>
            <p className="muted">
              Rate what you recalled or applied before consulting notes.
            </p>
            {review.schedule ? (
              <div className="rating-options">
                {[
                  "Forgot completely",
                  "Mostly forgot",
                  "Recalled with difficulty",
                  "Good recall",
                  "Effortless recall",
                ].map((label, i) => (
                  <Button
                    key={label}
                    disabled={busy}
                    onClick={() =>
                      action(async () => {
                        const r = await api(
                          "/reviews/" + review.schedule!.id + "/complete",
                          "POST",
                          { rating: i + 1 },
                        );
                        setReview(null);
                        if (r.next?.scheduled_at)
                          setAnchor(
                            DateTime.fromISO(r.next.scheduled_at)
                              .setZone(prefs.timezone)
                              .startOf("day"),
                          );
                        if (r.next && !r.next.scheduled_at)
                          return (
                            r.next.adjustment_reason ??
                            "Next review needs a time. Open Calendar to adjust it."
                          );
                        return `Review complete. Next review: ${date(r.next?.scheduled_at ?? null, prefs.timezone)}`;
                      }, "Review completed")
                    }
                  >
                    <span>{i + 1}</span>
                    {label}
                    <ArrowRight size={16} />
                  </Button>
                ))}
              </div>
            ) : (
              <p>No pending review. Restore this topic to schedule one.</p>
            )}
          </Dialog>
        )}
        {correct && (
          <Dialog
            title="Correct your rating"
            description="Only your latest review can be corrected. Changes are recorded in an audit trail."
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
                    }, "Rating corrected and schedule recalculated")
                  }
                >
                  {r} / 5
                </Button>
              ))}
            </div>
          </Dialog>
        )}
        {reschedule && (
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
                at ? "Manual schedule saved" : "Automatic scheduling restored",
              )
            }
          />
        )}
        {confirmArchive && (
          <Dialog
            title={
              confirmArchive.status === "archived"
                ? "Restore this topic?"
                : "Archive this topic?"
            }
            description="Your review history will be preserved."
            onClose={() => setConfirmArchive(null)}
          >
            <p>
              {confirmArchive.status === "archived"
                ? "We’ll schedule a new review using its existing memory state."
                : "Upcoming reviews will be cancelled and external events queued for removal."}
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
                }, "Topic updated")
              }
            >
              Confirm{" "}
              {confirmArchive.status === "archived" ? "restore" : "archive"}
            </Button>
          </Dialog>
        )}
        {dashboard !== emptyDashboard && !prefs.onboarded && (
          <Dialog
            title="Find your learning rhythm."
            description="A few preferences, then you’re ready. Google Calendar is optional."
            onClose={() => {}}
          >
            <SettingsForm
              prefs={prefs}
              busy={busy}
              compact
              onSave={(p) =>
                action(
                  () => api("/preferences", "PATCH", { ...p, onboarded: true }),
                  "You’re ready. Add your first topic.",
                )
              }
            />
          </Dialog>
        )}
      </div>
    </ErrorContext.Provider>
  );
}

const root = createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
