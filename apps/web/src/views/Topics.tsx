import { ArrowUpRight, Layers3, Plus, Search } from "lucide-react";
import type { Preferences } from "../../../../packages/shared/src/index";
import { date } from "../date";
import type { Topic } from "../types";
import { Button } from "../ui";
export function TopicsView({
  filtered,
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
          <h1>Topics</h1>
        </div>
        <Button className="primary" onClick={() => setEditor("new")}>
          <Plus size={18} /> Add topic
        </Button>
      </div>
      <div className="filters">
        <label className="search">
          <Search size={18} />
          <input
            aria-label="Search topics"
            placeholder="Find a topic…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter by tag"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select
          aria-label="Sort topics"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="date">Next review</option>
          <option value="importance">Importance</option>
          <option value="title">A–Z</option>
        </select>
        <label className="inline">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{" "}
          Archived
        </label>
      </div>
      {filtered.length ? (
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
                <span>{t.duration} min</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <h2>
            {query || tag
              ? "No matching topics"
              : archived
                ? "No archived topics"
                : "No topics yet"}
          </h2>
          {query || tag ? (
            <Button
              onClick={() => {
                setQuery("");
                setTag("");
              }}
            >
              Clear filters
            </Button>
          ) : (
            !archived && <p>Add a topic you studied to schedule a review.</p>
          )}
        </div>
      )}
    </>
  );
}
