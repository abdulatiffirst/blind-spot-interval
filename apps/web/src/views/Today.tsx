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
  reviews,
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
  reviews: Review[];
  today: Review[];
  prefs: Preferences;
  progress: number;
  openTopic: (id: string, review?: boolean) => void;
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
          <label htmlFor="first-topic">What did you learn recently?</label>
        </h1>
        <p id="first-topic-help">
          We will schedule your first review automatically.
        </p>
        <input
          id="first-topic"
          aria-label="Topic name"
          aria-describedby="first-topic-help"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="For example: Chain rule"
          required
        />
        <div className="example-chips">
          {["Chain rule", "Past perfect"].map((example) => (
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
          {busy ? "Saving…" : "Add topic"}
        </Button>
      </form>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Today</h1>
        </div>
        <Button className="primary" onClick={() => setEditor("new")}>
          <Plus size={18} /> Add topic
        </Button>
      </div>
      <div className="stats">
        <div>
          <span className="stat-label">
            Reviews today <ArrowUpRight size={18} />
          </span>
          <strong>{today.length.toString().padStart(2, "0")}</strong>
        </div>
        <div>
          <span className="stat-label">
            Active topics <Layers3 size={16} />
          </span>
          <strong>
            {new Set(reviews.map((r) => r.topic_id)).size
              .toString()
              .padStart(2, "0")}
          </strong>
        </div>
        <div className="accent-stat">
          <span className="stat-label">Review time today</span>
          <strong>
            {today.reduce((minutes, review) => minutes + review.duration, 0)}{" "}
            min
          </strong>
        </div>
      </div>
      <div className="progress-summary">
        <span>
          {progress} of {progress + today.length} reviews complete today
        </span>
        <progress
          aria-label="Today’s review progress"
          max={Math.max(1, progress + today.length)}
          value={progress}
        />
      </div>
      <div className="section-heading">
        <h2>
          Your review queue <span className="badge">{today.length}</span>
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
              onOpen={() => openTopic(r.topic_id, true)}
            />
          ))}
        </div>
      ) : (
        <p className="empty">No reviews due today.</p>
      )}
      <div className="section-heading upcoming-heading">
        <h2>Upcoming reviews</h2>
        <Button className="text-button" onClick={() => setSection("Calendar")}>
          View calendar <ArrowRight size={16} />
        </Button>
      </div>
      <div className="upcoming-grid">
        {reviews
          .filter((r) => !today.includes(r))
          .slice(0, 3)
          .map((r) => (
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
                {r.duration} min <ArrowUpRight size={16} />
              </span>
            </button>
          ))}
        {reviews.length === 0 && (
          <p className="muted">Your upcoming reviews will appear here.</p>
        )}
      </div>
    </>
  );
}
