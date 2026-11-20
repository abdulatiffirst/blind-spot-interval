import { ArrowUpRight, Layers3, Plus } from "lucide-react";
import { safeUrl } from "../../../packages/shared/src/index";
import { date } from "./date";
import type { Review } from "./types";
import { Button } from "./ui";
export function Logo() {
  return (
    <div className="logo">
      <img
        className="brand-mark"
        src="/favicon.svg"
        width="38"
        height="38"
        alt=""
      />
      <span>
        blind spot<small>INTERVAL</small>
      </span>
    </div>
  );
}
export function Empty({
  title,
  text,
  onAdd,
}: {
  title: string;
  text: string;
  onAdd: () => void;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Layers3 size={28} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      <Button onClick={onAdd}>
        Add your first topic <Plus size={16} />
      </Button>
    </div>
  );
}
export function ReviewRow({
  review: r,
  index,
  zone,
  onOpen,
}: {
  review: Review;
  index: number;
  zone: string;
  onOpen: () => void;
}) {
  const minutesUntil = r.scheduled_at
    ? Math.floor((Date.parse(r.scheduled_at) - Date.now()) / 60000)
    : null;
  return (
    <div className="review-row">
      <span className="row-number">{String(index + 1).padStart(2, "0")}</span>
      <span className="topic-icon">
        <Layers3 size={21} />
      </span>
      <div className="review-row-title">
        <h3>{r.title}</h3>
        <span>
          {date(r.scheduled_at, zone)}{" "}
          {minutesUntil !== null && (
            <b className={minutesUntil < 0 ? "overdue" : ""}>
              {minutesUntil < 0
                ? "Overdue"
                : minutesUntil === 0
                  ? "Due now"
                  : "Later today"}
            </b>
          )}
        </span>
      </div>
      <span className="duration">{r.duration} min</span>
      <Button onClick={onOpen}>
        Review <ArrowUpRight size={17} />
      </Button>
    </div>
  );
}
export function Materials({ items }: { items: { text: string }[] }) {
  return (
    <ul className="materials">
      {items.map((m, i) => (
        <li key={i}>
          {m.text.split(/(https?:\/\/[^\s]+)/).map((part, j) =>
            safeUrl(part) ? (
              <a
                key={j}
                href={safeUrl(part)!}
                target="_blank"
                rel="noopener noreferrer"
              >
                {part}
              </a>
            ) : (
              part
            ),
          )}
        </li>
      ))}
    </ul>
  );
}
