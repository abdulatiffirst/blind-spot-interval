import { ArrowUpRight, ArrowRight, Layers3, Plus } from "lucide-react";
import type { Preferences } from "../../../../packages/shared/src/index";
import { Empty, ReviewRow } from "../components";
import { date } from "../date";
import type { Review } from "../types";
import { Button } from "../ui";
export function TodayView({
  reviews,
  today,
  prefs,
  progress,
  openTopic,
  setEditor,
  setSection,
}: {
  reviews: Review[];
  today: Review[];
  prefs: Preferences;
  progress: number;
  openTopic: (id: string, review?: boolean) => void;
  setEditor: (topic: "new") => void;
  setSection: (section: string) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">A LITTLE PROGRESS, EVERY DAY</p>
          <h1>
            Make room for
            <br className="mobile-break" /> what you know
            <span className="lime-dot">.</span>
          </h1>
          <p className="subtitle">
            Your next small step toward lasting knowledge.
          </p>
        </div>
        <Button className="primary" onClick={() => setEditor("new")}>
          <Plus size={18} /> Add topic
        </Button>
      </div>
      <div className="stats">
        <div>
          <span className="stat-label">
            READY TO REVIEW <ArrowUpRight size={18} />
          </span>
          <strong>{today.length.toString().padStart(2, "0")}</strong>
          <small>A fresh chance to remember</small>
        </div>
        <div>
          <span className="stat-label">
            ACTIVE TOPICS <Layers3 size={16} />
          </span>
          <strong>
            {new Set(reviews.map((r) => r.topic_id)).size
              .toString()
              .padStart(2, "0")}
          </strong>
          <small>Ideas you’re making your own</small>
        </div>
        <div className="accent-stat">
          <span className="stat-label">
            YOUR NEXT STEP <span>✳</span>
          </span>
          <strong className="stat-text">
            Keep it
            <br />
            in motion.
          </strong>
          <small>
            {today.length
              ? `${today.reduce((n, r) => n + r.duration, 0)} minutes of review today`
              : "You’re all clear for today"}
          </small>
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
        <span className="muted">One topic at a time.</span>
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
        <Empty
          title="A clear mind. A clear queue."
          text="Add something you’ve learned. We’ll find the right moment to revisit it."
          onAdd={() => setEditor("new")}
        />
      )}
      <div className="section-heading upcoming-heading">
        <h2>A little further ahead</h2>
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
