import { translate, getLanguage, systemMessage } from "../i18n";
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
          <h1>{translate("calendar")}</h1>
          <p className="subtitle">
            {translate("scheduleZone", { zone: prefs.timezone })}
          </p>
        </div>
        <Button className="primary" onClick={() => setEditor("new")}>
          <Plus size={18} /> {translate("addTopic")}
        </Button>
      </div>
      <div className="connection-card">
        <div
          className={"status-dot " + (calendar.connected ? "connected" : "")}
        />
        <div>
          <strong>
            {calendar.connected
              ? translate("calendarConnected")
              : translate("internalCalendar")}
          </strong>
          <p>
            {calendar.error
              ? systemMessage(calendar.error)
              : calendar.connected
                ? translate("calendarSyncInfo")
                : translate("calendarConnectInfo")}
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
            <Link2 size={16} /> {translate("connectCalendar")}
          </a>
        )}
      </div>
      <div className="calendar-toolbar">
        <div>
          <Button
            className="icon-button"
            aria-label={translate("previousPeriod")}
            onClick={() =>
              setAnchor(
                anchor.minus(
                  calendarMode === "month"
                    ? { months: 1 }
                    : { days: calendarMode === "week" ? 7 : 1 },
                ),
              )
            }
          >
            <ChevronLeft />
          </Button>
          <strong>
            {anchor.setLocale(getLanguage()).toFormat("LLLL yyyy")}
          </strong>
          <Button
            className="icon-button"
            aria-label={translate("nextPeriod")}
            onClick={() =>
              setAnchor(
                anchor.plus(
                  calendarMode === "month"
                    ? { months: 1 }
                    : { days: calendarMode === "week" ? 7 : 1 },
                ),
              )
            }
          >
            <ChevronRight />
          </Button>
          <Button onClick={() => setAnchor(now.startOf("day"))}>
            {translate("today")}
          </Button>
        </div>
        <div>
          {(["day", "week", "month"] as const).map((v) => (
            <Button
              key={v}
              className={v === calendarMode ? "active" : ""}
              onClick={() => setCalendarMode(v)}
            >
              {translate(v)}
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
              {day.setLocale(getLanguage()).toFormat("ccc")}{" "}
              <strong>{day.day}</strong>
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
                    {translate("minutes", { count: r.duration })}
                  </small>
                  <strong>{r.title}</strong>
                  <span>{translate("changeTime")}</span>
                  <small>
                    {r.mode === "manual"
                      ? translate("manualOverride")
                      : translate("automatic")}
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
              {r.adjustment_reason
                ? systemMessage(r.adjustment_reason)
                : translate("unscheduled")}
            </span>
            <Button onClick={() => setReschedule(r)}>
              {translate("adjust")}
            </Button>
          </div>
        ))}
    </>
  );
}
