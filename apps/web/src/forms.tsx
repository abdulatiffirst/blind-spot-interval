import { translate, systemMessage } from "./i18n";
import { NumericInput } from "./NumericInput";
import { TagInput } from "./TagInput";
import { TimezonePicker } from "./TimezonePicker";
import { addWords } from "./form-options";
import { ArrowRight, Check, GripVertical, Plus, Trash2 } from "lucide-react";
import { DateTime } from "luxon";
import { useEffect, useId, useRef, useState } from "react";
import type { Preferences } from "../../../packages/shared/src/index";
import { api } from "./api";
import { relativeDay, fullDate } from "./date";
import type { Review, Topic } from "./types";
import { Button, Dialog } from "./ui";
function Level({
  label,
  help,
  value,
  onChange,
  disabled,
}: {
  label: string;
  help: string;
  value: number | null;
  onChange: (n: number | null) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className="level">
      <legend>{label}</legend>
      <div className="level-choices" role="group" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            type="button"
            key={n}
            disabled={disabled}
            aria-pressed={value === n}
            aria-describedby={id}
            onClick={() => onChange(value === n ? null : n)}
          >
            {n}
          </button>
        ))}
      </div>
      <details className="rating-help">
        <summary aria-label={translate("aboutRating", { label })}>?</summary>
        <span id={id} role="tooltip">
          {help}
        </span>
      </details>
    </fieldset>
  );
}
export function TopicEditor({
  topic,
  prefs,
  busy,
  tags,
  revision,
  initialTitle,
  onClose,
  onSave,
}: {
  topic: Topic | null;
  prefs: Preferences;
  busy: boolean;
  tags: string[];
  revision: number;
  initialTitle: string;
  onClose: () => void;
  onSave: (v: Record<string, unknown>, key?: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const dialog = formRef.current?.closest<HTMLElement>(".dialog");
    if (!viewport || !dialog) return;
    const resize = () => {
      dialog.style.maxHeight = viewport.height - 16 + "px";
      dialog.style.top = viewport.offsetTop + viewport.height / 2 + "px";
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, []);
  const [title, setTitle] = useState(topic?.title ?? initialTitle),
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
    [manual, setManual] = useState<string | null>(null),
    [validDuration, setValidDuration] = useState(true),
    [retry, setRetry] = useState(0);
  const local =
    manual === null ? null : DateTime.fromISO(manual, { zone: prefs.timezone });
  const manualValid =
    !local ||
    (local.isValid &&
      local.toFormat("yyyy-MM-dd'T'HH:mm") === manual &&
      local.toMillis() > Date.now());
  const query = new URLSearchParams({
    duration: String(duration),
    ...(knowledge ? { knowledge: String(knowledge) } : {}),
    ...(importance ? { importance: String(importance) } : {}),
    ...(local?.isValid ? { scheduledAt: local.toUTC().toISO()! } : {}),
  }).toString();
  const requestKey = JSON.stringify([query, prefs, revision, retry]);
  type Preview = {
    start: string | null;
    retention: number;
    reason: string | null;
    mode: string;
  };
  const [result, setResult] = useState<{
    key: string;
    preview: Preview | null;
  } | null>(null);
  const ready = manualValid && validDuration;
  const current = ready && result?.key === requestKey ? result : null;
  const preview = current?.preview;
  useEffect(() => {
    if (topic || !ready) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api("/schedule/preview?" + query, "GET", undefined, {
        signal: controller.signal,
      })
        .then((preview) => {
          if (!controller.signal.aborted)
            setResult({ key: requestKey, preview });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setResult({ key: requestKey, preview: null });
        });
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, ready, requestKey, topic]);
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
  const submissionKey = useRef<string | null>(null);
  function move(i: number, offset: number) {
    const copy = [...materials];
    [copy[i], copy[i + offset]] = [copy[i + offset], copy[i]];
    setMaterials(copy);
  }
  return (
    <Dialog
      title={topic ? translate("editYourTopic") : translate("addTopic")}
      description={topic ? translate("editSubtitle") : translate("addSubtitle")}
      onClose={onClose}
    >
      <form
        ref={formRef}
        className="topic-editor"
        onSubmit={(e) => {
          e.preventDefault();
          const entered = addWords(selectedTags, draft);
          if (entered.error) {
            setTagError(entered.error);
            return;
          }
          if (!topic && !preview) return;
          submissionKey.current ??= crypto.randomUUID();
          onSave(
            {
              title,
              initialKnowledge: knowledge,
              importance,
              duration,
              tags: entered.tags,
              materials: materials.filter((t) => t.trim()),
              ...(!topic && preview
                ? {
                    expectedStart: preview.start,
                    ...(local ? { scheduledAt: local.toUTC().toISO() } : {}),
                  }
                : {}),
            },
            submissionKey.current,
          );
        }}
      >
        <div className="editor-scroll">
          <label>
            {translate("topicName")} <span className="required">*</span>
            <input
              autoFocus
              required
              maxLength={200}
              placeholder={translate("newPlaceholder")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="rating-fields">
            <Level
              label={translate("knowledge")}
              help={translate("knowledgeHelp")}
              value={knowledge}
              disabled={!!topic}
              onChange={setKnowledge}
            />
            <Level
              label={translate("importance")}
              help={translate("importanceHelp")}
              value={importance}
              onChange={setImportance}
            />
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
          <label htmlFor="material-first">{translate("materials")}</label>
          <div className="material-editor">
            {materials.map((text, i) => (
              <div className="material-line" key={i}>
                <GripVertical size={15} />
                <input
                  id={i === 0 ? "material-first" : undefined}
                  maxLength={2000}
                  data-material={i}
                  aria-label={translate("material", { n: i + 1 })}
                  value={text}
                  placeholder={translate("materialPlaceholder")}
                  onChange={(e) =>
                    setMaterials(
                      materials.map((m, j) => (i === j ? e.target.value : m)),
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (materials.length >= 100) return;
                      setMaterials([
                        ...materials.slice(0, i + 1),
                        "",
                        ...materials.slice(i + 1),
                      ]);
                      setTimeout(
                        () =>
                          document
                            .querySelector<HTMLInputElement>(
                              `[data-material="${i + 1}"]`,
                            )
                            ?.focus(),
                        0,
                      );
                    }
                    if (
                      e.key === "Backspace" &&
                      !text &&
                      materials.length > 1
                    ) {
                      e.preventDefault();
                      setMaterials(materials.filter((_, j) => i !== j));
                    }
                  }}
                />
                <Button
                  type="button"
                  className="icon-button"
                  aria-label={translate("materialUp", { n: i + 1 })}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  className="icon-button"
                  aria-label={translate("materialDown", { n: i + 1 })}
                  disabled={i === materials.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  className="icon-button"
                  aria-label={translate("materialDelete", { n: i + 1 })}
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
            disabled={materials.length >= 100}
            onClick={() => setMaterials([...materials, ""])}
          >
            <Plus size={14} /> {translate("addBullet")}
          </Button>
          <label>
            {translate("duration")}
            <NumericInput
              min={5}
              max={180}

              onValidity={setValidDuration}
              value={duration}
              onChange={setDuration}
            />
          </label>
          {!topic && (
            <section className="preview" aria-label={translate("nextReview")}>
              <h3>{translate("nextReview")}</h3>
              <div aria-live="polite" aria-busy={ready && !current}>
                <strong>
                  {!manualValid
                    ? translate("futureTime")
                    : !validDuration
                      ? translate("checkDuration")
                      : !current
                        ? translate("calculating")
                        : !preview
                          ? translate("previewFailed")
                          : fullDate(preview.start, prefs.timezone)}
                </strong>
                {preview?.start && (
                  <span>{relativeDay(preview.start, prefs.timezone)}</span>
                )}
                {preview?.reason && <p>{systemMessage(preview.reason)}</p>}
              </div>
              {manual !== null && (
                <label>
                  {translate("changeDate", { zone: prefs.timezone })}
                  <input
                    autoFocus
                    type="datetime-local"
                    required
                    value={manual}
                    aria-invalid={!manualValid}
                    onChange={(e) => setManual(e.target.value)}
                  />
                </label>
              )}
              <div className="inline">
                {manual === null ? (
                  <Button
                    type="button"
                    onClick={() =>
                      setManual(
                        preview?.start
                          ? DateTime.fromISO(preview.start)
                              .setZone(prefs.timezone)
                              .toFormat("yyyy-MM-dd'T'HH:mm")
                          : "",
                      )
                    }
                  >
                    {translate("change")}
                  </Button>
                ) : (
                  <Button type="button" onClick={() => setManual(null)}>
                    {translate("reset")}
                  </Button>
                )}
                {current && !preview && (
                  <Button type="button" onClick={() => setRetry((n) => n + 1)}>
                    {translate("retry")}
                  </Button>
                )}
              </div>
            </section>
          )}
          {!topic && preview && (
            <p className="schedule-summary">
              {translate("scheduleSummary", {
                duration,
                retention: Math.round(preview.retention * 100),
                mode:
                  manual === null
                    ? translate("automatic")
                    : translate("manual"),
              })}
            </p>
          )}
        </div>
        <div className="form-actions">
          <Button type="button" onClick={onClose}>
            {translate("cancel")}
          </Button>
          <Button
            className="primary"
            disabled={busy || !title.trim() || (!topic && !preview)}
          >
            {busy
              ? translate("saving")
              : topic
                ? translate("saveChanges")
                : translate("addTopic")}{" "}
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
      title={translate("rescheduleDialog")}
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
          {translate("reviewTime")}
          <input
            type="datetime-local"
            required
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </label>
        <p className="muted">{translate("manualInfo")}</p>
        <div className="form-actions">
          <Button type="button" disabled={busy} onClick={() => onSave()}>
            {translate("resetAuto")}
          </Button>
          <Button className="primary" disabled={busy}>
            {translate("saveTime")}
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
      <h2>{translate("studyPrefs")}</h2>
      <TimezonePicker
        value={p.timezone}
        onChange={(v) => update("timezone", v)}
      />
      <div className="form-columns">
        <label>
          {translate("studyStart")}
          <input
            required
            type="time"
            value={p.studyStart}
            onChange={(e) => update("studyStart", e.target.value)}
          />
        </label>
        <label>
          {translate("studyEnd")}
          <input
            required
            type="time"
            value={p.studyEnd}
            onChange={(e) => update("studyEnd", e.target.value)}
          />
        </label>
      </div>
      <label>
        {translate("defaultDuration")}
        <NumericInput
          min={5}
          max={180}
          value={p.duration}
          onChange={(number) => update("duration", number)}
        />
      </label>

      <h3>{translate("flexibility")}</h3>
      <div className="form-columns">
        <label>
          {translate("beforeIdeal")}
          <NumericInput
            min={0}
            max={7}
            value={p.daysBefore}
            onChange={(number) => update("daysBefore", number)}
          />
        </label>
        <label>
          {translate("afterIdeal")}
          <NumericInput
            min={0}
            max={14}
            value={p.daysAfter}
            onChange={(number) => update("daysAfter", number)}
          />
        </label>
      </div>
      <details>
        <summary>{translate("advancedMemory")}</summary>
        <p className="muted">{translate("retentionHelp")}</p>
        {p.retention.map((value, i) => (
          <label key={i}>
            {translate("retentionLevel", { n: i + 1 })}
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
          {busy ? translate("saving") : translate("savePrefs")}{" "}
          <Check size={16} />
        </Button>
      </div>
    </form>
  );
}
