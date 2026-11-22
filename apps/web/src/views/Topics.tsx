import { translate } from "../i18n";
import { Skeleton } from "../Skeleton";
import { ArrowUpRight, Layers3, Plus, Search } from "lucide-react";
import type { Preferences } from "../../../../packages/shared/src/index";
import { date } from "../date";
import type { Topic } from "../types";
import { Button } from "../ui";
export function TopicsView({
  filtered,
  loading,
  loadFailed,
  retry,
  tags,
  query,
  setQuery,
  tag,
  setTag,
  sort,
  setSort,
  archived,
  setArchived,
  setEditor,
  openTopic,
  prefs,
}: {
  filtered: Topic[];
  loading: boolean;
  loadFailed: boolean;
  retry: () => void;
  tags: string[];
  query: string;
  setQuery: (s: string) => void;
  tag: string;
  setTag: (s: string) => void;
  sort: string;
  setSort: (s: string) => void;
  archived: boolean;
  setArchived: (v: boolean) => void;
  setEditor: (topic: Topic | "new") => void;
  openTopic: (id: string) => void;
  prefs: Preferences;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{translate("topics")}</h1>
        </div>
        <Button className="primary" onClick={() => setEditor("new")}>
          <Plus size={18} /> {translate("addTopic")}
        </Button>
      </div>
      <div className="filters">
        <label className="search">
          <Search size={18} />
          <input
            aria-label={translate("searchTopics")}
            placeholder={translate("findTopic")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label={translate("filterTag")}
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        >
          <option value="">{translate("allTags")}</option>
          {tags.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select
          aria-label={translate("sortTopics")}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="date">{translate("nextReview")}</option>
          <option value="importance">{translate("importance")}</option>
          <option value="title">{translate("alphabetical")}</option>
        </select>
        <label className="archived-pill">
          <input
            type="checkbox"
            role="switch"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{" "}
          {translate("archived")}
        </label>
      </div>
      {loading ? (
        loadFailed ? (
          <Button onClick={retry}>{translate("retry")}</Button>
        ) : (
          <Skeleton section="Topics" compact />
        )
      ) : filtered.length ? (
        <div className="topic-grid">
          {filtered.map((t) => (
            <button
              key={t.id}
              className="topic-card"
              onClick={() => openTopic(t.id)}
            >
              <div className="topic-card-top">
                <span className="topic-icon">
                  <Layers3 size={20} />
                </span>
                <ArrowUpRight size={19} />
              </div>
              <h2>{t.title}</h2>
              <div className="tags">
                {t.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <div className="topic-card-bottom">
                <span>
                  {date(
                    t.schedule?.scheduled_at ?? null,
                    prefs.timezone,
                    "d LLL · HH:mm",
                  )}
                </span>
                <span>
                  {t.duration} {translate("min")}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <h2>
            {query || tag
              ? translate("noMatches")
              : archived
                ? translate("noArchive")
                : translate("noTopics")}
          </h2>
          {query || tag ? (
            <Button
              onClick={() => {
                setQuery("");
                setTag("");
              }}
            >
              {translate("clearFilters")}
            </Button>
          ) : (
            !archived && <p>{translate("emptyTopicsCopy")}</p>
          )}
        </div>
      )}
    </>
  );
}
