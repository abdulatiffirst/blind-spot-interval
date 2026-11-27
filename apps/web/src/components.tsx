import { translate } from "./i18n";
import { ArrowUpRight, Layers3 } from "lucide-react";
import { materialParts } from "./material-links";
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
                ? translate("overdue")
                : minutesUntil === 0
                  ? translate("dueNow")
                  : translate("laterToday")}
            </b>
          )}
        </span>
      </div>
      <span className="duration">
        {r.duration} {translate("min")}
      </span>
      <Button onClick={onOpen}>
        {translate("review")} <ArrowUpRight size={17} />
      </Button>
    </div>
  );
}
export function Materials({ items = [] }: { items?: { text: string }[] }) {
  if (!items.length) return null;
  return (
    <ul className="materials">
      {items.map((m, i) => (
        <li
          key={i}
          className={
            /^\s*[-*•‣◦]\s/u.test(m.text) ? "material-with-bullet" : undefined
          }
        >
          {materialParts(m.text).map((part, j) =>
            typeof part === "string" ? (
              part
            ) : (
              <a
                key={j}
                href={part.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {part.text}
              </a>
            ),
          )}
        </li>
      ))}
    </ul>
  );
}
