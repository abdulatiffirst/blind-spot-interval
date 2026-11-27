import { translate } from "../i18n";
import { useState } from "react";
import { ArrowUpRight, ArrowRight, Layers3, Plus } from "lucide-react";
import type { Preferences } from "../../../../packages/shared/src/index";
import { ReviewRow } from "../components";
import { date } from "../date";
import type { Review } from "../types";
import { Button } from "../ui";
export function TodayView({
  hasTopics,
  busy,
  onCreate,
  upcoming,
  activeCount,
  today,
  prefs,
  progress,
  openTopic,
  setEditor,
  setSection,
}: {
  hasTopics: boolean;
  busy: boolean;
  onCreate: (title: string) => void;
  upcoming: Review[];
  activeCount: number;
  today: Review[];
  prefs: Preferences;
  progress: number;
  openTopic: (id: string, reviewScheduleId?: string) => void;
  setEditor: (topic: "new") => void;
  setSection: (section: string) => void;
}) {
  const [title, setTitle] = useState("");
  if (!hasTopics)
    return (
      <form
        className="first-topic"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() && !busy) onCreate(title.trim());
        }}
      >
        <h1>
          <label htmlFor="first-topic">{translate("firstPrompt")}</label>
        </h1>
        <p id="first-topic-help">{translate("firstHelp")}</p>
        <input
          id="first-topic"
          aria-label={translate("topicName")}
          aria-describedby="first-topic-help"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={translate("exampleTitle")}
          required
        />
        <div className="example-chips">
          {[translate("chainRule"), translate("pastPerfect")].map((example) => (
            <Button
              type="button"
              key={example}
              onClick={() => setTitle(example)}
            >
              {example}
            </Button>
          ))}
        </div>
        <Button className="primary" disabled={busy || !title.trim()}>
          {busy ? translate("saving") : translate("addTopic")}
        </Button>
      </form>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{translate("today")}</h1>
        </div>
        <Button className="primary" onClick={() => setEditor("new")}>
          <Plus size={18} /> {translate("addTopic")}
        </Button>
      </div>
      <div className="stats">
        <div>
          <span className="stat-label">
            {translate("reviewsToday")} <ArrowUpRight size={18} />
          </span>
          <strong>{today.length.toString().padStart(2, "0")}</strong>
        </div>
        <div>
          <span className="stat-label">
            {translate("activeTopics")} <Layers3 size={16} />
          </span>
          <strong>{activeCount.toString().padStart(2, "0")}</strong>
        </div>
        <div className="accent-stat">
          <span className="stat-label">{translate("reviewTimeToday")}</span>
          <strong>
            {today.reduce((minutes, review) => minutes + review.duration, 0)}{" "}
            {translate("min")}
          </strong>
        </div>
      </div>
      <div className="progress-summary">
        <span>
          {translate("completedToday", {
            done: progress,
            total: progress + today.length,
          })}
        </span>
        <progress
          aria-label={translate("todayProgress")}
          max={Math.max(1, progress + today.length)}
          value={progress}
        />
      </div>
      <div className="section-heading">
        <h2>
          {translate("yourQueue")} <span className="badge">{today.length}</span>
        </h2>
      </div>
      {today.length ? (
        <div className="review-list">
          {today.map((r, i) => (
            <ReviewRow
              key={r.id}
              review={r}
              index={i}
              zone={prefs.timezone}
              onOpen={() => openTopic(r.topic_id, r.id)}
            />
          ))}
        </div>
      ) : (
        <p className="empty">{translate("nothingDue")}</p>
      )}
      <div className="section-heading upcoming-heading">
        <h2>{translate("upcoming")}</h2>
        <Button className="text-button" onClick={() => setSection("Calendar")}>
          {translate("viewCalendar")} <ArrowRight size={16} />
        </Button>
      </div>
      <div className="upcoming-grid">
        {upcoming.map((r) => (
          <button
            className="upcoming-card"
            key={r.id}
            onClick={() => openTopic(r.topic_id)}
          >
            <span className="eyebrow">
              {date(r.scheduled_at, prefs.timezone, "ccc, d LLL")}
            </span>
            <h3>{r.title}</h3>
            <span>
              {r.duration} {translate("min")} <ArrowUpRight size={16} />
            </span>
          </button>
        ))}
        {activeCount === 0 && (
          <p className="muted">{translate("upcomingEmpty")}</p>
        )}
      </div>
    </>
  );
}
