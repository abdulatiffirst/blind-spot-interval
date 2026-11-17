import { connectCalendar } from "../api";
import { ChevronLeft, ChevronRight, Link2, Plus } from "lucide-react";
import { DateTime } from "luxon";
import type { Preferences } from "../../../../packages/shared/src/index";
import { date } from "../date";
import type { Review, Topic } from "../types";
import { Button } from "../ui";
export function CalendarView({
  onError,
  prefs,
  calendar,
  setEditor,
  calendarMode,
  setCalendarMode,
  anchor,
  setAnchor,
  now,
  reviews,
  setReschedule,
}: {
  onError: (message: string) => void;
  prefs: Preferences;
  calendar: any;
  setEditor: (topic: Topic | "new") => void;
  calendarMode: string;
  setCalendarMode: (s: string) => void;
  anchor: DateTime;
  setAnchor: (v: DateTime) => void;
  now: DateTime;
  reviews: Review[];
  setReschedule: (v: Review) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">FIND YOUR RHYTHM</p>
          <h1>A little time to remember.</h1>
          <p className="subtitle">Your review schedule · {prefs.timezone}</p>
        </div>
        <Button className="primary" onClick={() => setEditor("new")}>
          <Plus size={18} /> Add topic
        </Button>
      </div>
      <div className="connection-card">
        <div
          className={"status-dot " + (calendar.connected ? "connected" : "")}
        />
        <div>
          <strong>
            {calendar.connected
              ? "Google Calendar connected"
              : "Your internal calendar is ready"}
          </strong>
          <p>
            {calendar.error ??
              (calendar.connected
                ? "Reviews sync automatically. External availability uses your primary calendar."
                : "Connect Google to account for your primary calendar’s busy times.")}
          </p>
        </div>
        {!calendar.connected && (
          <a
            className="button"
            href="/api/v1/calendar/connect"
            onClick={(e) => {
              e.preventDefault();
              connectCalendar().catch((e) => onError(e.message));
            }}
          >
            <Link2 size={16} /> Connect Google
          </a>
        )}
      </div>
      <div className="calendar-toolbar">
        <div>
          <Button
            className="icon-button"
            aria-label="Previous period"
            onClick={() =>
              setAnchor(
                anchor.minus({
                  days:
                    calendarMode === "day"
                      ? 1
                      : calendarMode === "week"
                        ? 7
                        : 30,
                }),
              )
            }
          >
            <ChevronLeft />
          </Button>
          <strong>{anchor.toFormat("LLLL yyyy")}</strong>
          <Button
            className="icon-button"
            aria-label="Next period"
            onClick={() =>
              setAnchor(
                anchor.plus({
                  days:
                    calendarMode === "day"
                      ? 1
                      : calendarMode === "week"
                        ? 7
                        : 30,
                }),
              )
            }
          >
            <ChevronRight />
          </Button>
          <Button onClick={() => setAnchor(now.startOf("day"))}>Today</Button>
        </div>
        <div>
          {["day", "week", "month"].map((v) => (
            <Button
              key={v}
              className={v === calendarMode ? "active" : ""}
              onClick={() => setCalendarMode(v)}
            >
              {v}
            </Button>
          ))}
        </div>
      </div>
      <div className={"calendar-grid " + calendarMode}>
        {Array.from(
          {
            length:
              calendarMode === "day" ? 1 : calendarMode === "week" ? 7 : 42,
          },
          (_, i) =>
            (calendarMode === "day"
              ? anchor
              : calendarMode === "week"
                ? anchor.startOf("week")
                : anchor.startOf("month").startOf("week")
            ).plus({ days: i }),
        ).map((day) => (
          <div
            className={
              day.hasSame(now, "day")
                ? "calendar-cell current-day"
                : "calendar-cell"
            }
            key={day.toISO()}
          >
            <span>
              {day.toFormat("ccc")} <strong>{day.day}</strong>
            </span>
            {reviews
              .filter(
                (r) =>
                  r.scheduled_at &&
                  DateTime.fromISO(r.scheduled_at)
                    .setZone(prefs.timezone)
                    .hasSame(day, "day"),
              )
              .map((r) => (
                <button key={r.id} onClick={() => setReschedule(r)}>
                  <small>
                    {date(r.scheduled_at, prefs.timezone, "HH:mm")} ·{" "}
                    {r.duration}m
                  </small>
                  <strong>{r.title}</strong>
                  <small>
                    {r.mode === "manual" ? "Manual override" : "Automatic"}
                  </small>
                </button>
              ))}
          </div>
        ))}
      </div>
      {reviews
        .filter((r) => r.adjustment_reason || !r.scheduled_at)
        .map((r) => (
          <div className="banner" key={r.id}>
            <span>
              <strong>{r.title}</strong>:{" "}
              {r.adjustment_reason ?? "Not scheduled"}
            </span>
            <Button onClick={() => setReschedule(r)}>Adjust</Button>
          </div>
        ))}
    </>
  );
}
