import { NumericInput } from "./NumericInput";
import { TagInput } from "./TagInput";
import { TimezonePicker } from "./TimezonePicker";
import { addWords } from "./form-options";
import { ArrowRight, Check, GripVertical, Plus, Trash2 } from "lucide-react";
import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import type { Preferences } from "../../../packages/shared/src/index";
import { api } from "./api";
import { date } from "./date";
import type { Review, Topic } from "./types";
import { Button, Dialog } from "./ui";
export function TopicEditor({
  topic,
  prefs,
  busy,
  tags,
  onClose,
  onSave,
}: {
  topic: Topic | null;
  prefs: Preferences;
  busy: boolean;
  tags: string[];
  onClose: () => void;
  onSave: (v: any) => void;
}) {
  const [title, setTitle] = useState(topic?.title ?? ""),
    [knowledge, setKnowledge] = useState<number | null>(
      topic?.initial_knowledge ?? null,
    ),
    [importance, setImportance] = useState<number | null>(
      topic?.importance ?? null,
    ),
    [duration, setDuration] = useState(topic?.duration ?? prefs.duration),
    [selectedTags, setTags] = useState<string[]>(topic?.tags ?? []),
    [draft, setDraft] = useState(""),
    [tagError, setTagError] = useState(""),
    [materials, setMaterials] = useState<string[]>(
      topic?.materials.map((m) => m.text) ?? [""],
    ),
    [preview, setPreview] = useState<any>(null),
    [previewFailed, setPreviewFailed] = useState(false),
    [manual, setManual] = useState("");
  useEffect(() => {
    if (topic) return;
    setPreview(null);
    setPreviewFailed(false);
    const controller = new AbortController();
    const q = new URLSearchParams({
      duration: String(duration),
      ...(knowledge ? { knowledge: String(knowledge) } : {}),
      ...(importance ? { importance: String(importance) } : {}),
    });
    api("/schedule/preview?" + q, "GET", undefined, {
      signal: controller.signal,
    })
      .then((v) => {
        if (!controller.signal.aborted) setPreview(v);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPreviewFailed(true);
      });
    return () => controller.abort();
  }, [topic, knowledge, importance, duration]);
  const [knownTags, setKnownTags] = useState<string[]>(tags);
  useEffect(() => {
    const controller = new AbortController();
    api("/tags", "GET", undefined, { signal: controller.signal })
      .then((rows: { name: string }[]) => {
        if (!controller.signal.aborted)
          setKnownTags(rows.map((row) => row.name));
      })
      .catch(() => {}); // Loaded topic tags remain available if the optional lookup fails.
    return () => controller.abort();
  }, []);
  function move(i: number, offset: number) {
    const copy = [...materials];
    [copy[i], copy[i + offset]] = [copy[i + offset], copy[i]];
    setMaterials(copy);
  }
  return (
    <Dialog
      title={topic ? "Edit your topic" : "What did you learn?"}
      description="A topic today. Knowledge that lasts."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const entered = addWords(selectedTags, draft);
          if (entered.error) {
            setTagError(entered.error);
            return;
          }
          onSave({
            title,
            initialKnowledge: knowledge,
            importance,
            duration,
            tags: entered.tags,
            materials: materials.filter((t) => t.trim()),
            ...(!topic && manual
              ? {
                  scheduledAt: DateTime.fromISO(manual, {
                    zone: prefs.timezone,
                  })
                    .toUTC()
                    .toISO(),
                }
              : {}),
          });
        }}
      >
        <label>
          Topic name <span className="required">*</span>
          <input
            autoFocus
            required
            maxLength={200}
            placeholder="e.g. The change-of-base formula"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="form-columns">
          <div>
            <label htmlFor="knowledge">
              Initial knowledge <span className="muted">optional</span>
            </label>
            <select
              id="knowledge"
              value={knowledge ?? ""}
              disabled={!!topic}
              onChange={(e) =>
                setKnowledge(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">Not assessed</option>
              {[
                "Completely new",
                "Limited knowledge",
                "Moderate knowledge",
                "Good knowledge",
                "Excellent knowledge",
              ].map((s, i) => (
                <option key={s} value={i + 1}>
                  {i + 1} — {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="importance">
              Importance <span className="muted">optional</span>
            </label>
            <select
              id="importance"
              value={importance ?? ""}
              onChange={(e) =>
                setImportance(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">Not set</option>
              {[
                "Low importance",
                "Somewhat important",
                "Normal",
                "Very important",
                "Essential",
              ].map((s, i) => (
                <option key={s} value={i + 1}>
                  {i + 1} — {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <TagInput
          tags={selectedTags}
          setTags={setTags}
          draft={draft}
          setDraft={setDraft}
          error={tagError}
          setError={setTagError}
          suggestions={knownTags}
        />
        <label>Study materials</label>
        <div className="material-editor">
          {materials.map((text, i) => (
            <div className="material-line" key={i}>
              <GripVertical size={15} />
              <input
                aria-label={`Material ${i + 1}`}
                value={text}
                placeholder="A note, a link, a little reminder…"
                onChange={(e) =>
                  setMaterials(
                    materials.map((m, j) => (i === j ? e.target.value : m)),
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setMaterials([
                      ...materials.slice(0, i + 1),
                      "",
                      ...materials.slice(i + 1),
                    ]);
                    setTimeout(
                      () =>
                        document
                          .querySelector<HTMLInputElement>(
                            `[aria-label="Material ${i + 2}"]`,
                          )
                          ?.focus(),
                      0,
                    );
                  }
                  if (e.key === "Backspace" && !text && materials.length > 1) {
                    e.preventDefault();
                    setMaterials(materials.filter((_, j) => i !== j));
                  }
                }}
              />
              <Button
                type="button"
                className="icon-button"
                aria-label={`Move material ${i + 1} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </Button>
              <Button
                type="button"
                className="icon-button"
                aria-label={`Move material ${i + 1} down`}
                disabled={i === materials.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </Button>
              <Button
                type="button"
                className="icon-button"
                aria-label={`Delete material ${i + 1}`}
                onClick={() =>
                  setMaterials(
                    materials.length === 1
                      ? [""]
                      : materials.filter((_, j) => i !== j),
                  )
                }
              >
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          className="text-button"
          onClick={() => setMaterials([...materials, ""])}
        >
          <Plus size={14} /> Add bullet
        </Button>
        <label>
          Review duration (minutes)
          <NumericInput
            min={5}
            max={180}

            value={duration}
            onChange={setDuration}
          />
        </label>
        {!topic && (
          <div className="preview">
            <div>
              <span className="eyebrow">YOUR FIRST REVIEW</span>
              <strong>
                {preview
                  ? date(preview.start, prefs.timezone)
                  : previewFailed
                    ? "Schedule preview unavailable"
                    : "Calculating…"}
              </strong>
              <span>
                {duration} min ·{" "}
                {preview
                  ? Math.round(preview.retention * 100)
                  : Math.round(prefs.retention[(importance ?? 3) - 1] * 100)}
                % target retention · {manual ? "Manual" : "Automatic"}
              </span>
            </div>
            <label>
              Change date ({prefs.timezone})
              <input
                type="datetime-local"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
              />
            </label>
            {preview?.reason && <p>{preview.reason}</p>}
          </div>
        )}
        <div className="form-actions">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button className="primary" disabled={busy || !title.trim()}>
            {busy ? "Saving…" : topic ? "Save changes" : "Add topic"}{" "}
            <ArrowRight size={16} />
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
export function Reschedule({
  review,
  zone,
  busy,
  onClose,
  onSave,
}: {
  review: Review;
  zone: string;
  busy: boolean;
  onClose: () => void;
  onSave: (at?: string) => void;
}) {
  const [at, setAt] = useState(
    review.scheduled_at
      ? DateTime.fromISO(review.scheduled_at)
          .setZone(zone)
          .toFormat("yyyy-MM-dd'T'HH:mm")
      : "",
  );
  return (
    <Dialog
      title="Make room for review"
      description={`${review.title} · ${zone}`}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(DateTime.fromISO(at, { zone }).toUTC().toISO()!);
        }}
      >
        <label>
          Review time
          <input
            type="datetime-local"
            required
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </label>
        <p className="muted">
          A manual time stays in place until you return to automatic scheduling.
          Memory estimates stay unchanged.
        </p>
        <div className="form-actions">
          <Button type="button" disabled={busy} onClick={() => onSave()}>
            Return to automatic
          </Button>
          <Button className="primary" disabled={busy}>
            Save time
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
export function SettingsForm({
  prefs,
  busy,
  onSave,
}: {
  prefs: Preferences;
  busy: boolean;
  onSave: (p: Preferences) => void;
}) {
  const [p, setP] = useState(prefs);
  useEffect(() => setP(prefs), [prefs]);
  const update = (key: keyof Preferences, value: any) =>
    setP({ ...p, [key]: value });
  return (
    <form
      className="settings-card"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...p, onboarded: true });
      }}
    >
      <h2>Study preferences</h2>
      <TimezonePicker
        value={p.timezone}
        onChange={(v) => update("timezone", v)}
      />
      <div className="form-columns">
        <label>
          Study hours start
          <input
            required
            type="time"
            value={p.studyStart}
            onChange={(e) => update("studyStart", e.target.value)}
          />
        </label>
        <label>
          Study hours end
          <input
            required
            type="time"
            value={p.studyEnd}
            onChange={(e) => update("studyEnd", e.target.value)}
          />
        </label>
      </div>
      <label>
        Default duration (minutes)
        <NumericInput
          min={5}
          max={180}
          value={p.duration}
          onChange={(number) => update("duration", number)}
        />
      </label>

      <h3>Scheduling flexibility</h3>
      <div className="form-columns">
        <label>
          Days before ideal date
          <NumericInput
            min={0}
            max={7}
            value={p.daysBefore}
            onChange={(number) => update("daysBefore", number)}
          />
        </label>
        <label>
          Days after ideal date
          <NumericInput
            min={0}
            max={14}
            value={p.daysAfter}
            onChange={(number) => update("daysAfter", number)}
          />
        </label>
      </div>
      <details>
        <summary>Advanced memory preferences</summary>
        <p className="muted">
          Higher retention means more frequent reviews. Changes apply to future
          review calculations.
        </p>
        {p.retention.map((value, i) => (
          <label key={i}>
            Importance {i + 1} retention (%)
            <NumericInput
              min={80}
              max={97}
              decimal
              value={Number((value * 100).toPrecision(15))}
              onChange={(number) =>
                update(
                  "retention",
                  p.retention.map((v, j) => (i === j ? number / 100 : v)),
                )
              }
            />
          </label>
        ))}
      </details>
      <div className="form-actions">
        <Button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save preferences"} <Check size={16} />
        </Button>
      </div>
    </form>
  );
}
