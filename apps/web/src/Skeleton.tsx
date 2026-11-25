import { translate } from "./i18n";
export function Skeleton({
  section,
  compact = false,
  account = false,
}: {
  section: string;
  compact?: boolean;
  account?: boolean;
}) {
  const calendar = section === "Calendar",
    topics = section === "Topics",
    settings = section === "Settings";
  return (
    <div className="loading-layout" role="status">
      <span className="sr-only">
        {translate(
          account
            ? "loadingWorkspace"
            : calendar
              ? "loadingCalendar"
              : topics
                ? "loadingTopics"
                : settings
                  ? "loadingSettings"
                  : "loadingReviews",
        )}
      </span>
      <div aria-hidden="true">
        {!compact && <div className="loading-heading" />}
        <div
          className={
            calendar
              ? "loading-calendar"
              : topics
                ? "topic-grid"
                : settings
                  ? "settings-layout"
                  : "stats"
          }
        >
          {Array.from({ length: calendar ? 14 : settings ? 2 : 3 }, (_, i) => (
            <div className="loading-card" key={i}>
              <i />
              <i />
            </div>
          ))}
        </div>
        {!calendar && !topics && !settings && (
          <div className="loading-rows">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
    </div>
  );
}
