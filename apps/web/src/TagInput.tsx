import { useId, useState } from "react";
import { addWords } from "./form-options";
export function TagInput({
  tags,
  setTags,
  draft,
  setDraft,
  suggestions,
  error,
  setError,
}: {
  tags: string[];
  setTags: (v: string[]) => void;
  draft: string;
  setDraft: (v: string) => void;
  suggestions: string[];
  error: string;
  setError: (v: string) => void;
}) {
  const id = useId(),
    [show, setShow] = useState(false),
    [active, setActive] = useState(-1);
  const matches =
    show && draft
      ? suggestions
          .filter(
            (t) =>
              !/\s/.test(t) &&
              t.toLowerCase().includes(draft.toLowerCase()) &&
              !tags.some((x) => x.toLowerCase() === t.toLowerCase()),
          )
          .slice(0, 8)
      : [];
  function commit(text: string) {
    const result = addWords(tags, text);
    setTags(result.tags);
    setError(result.error);
    setDraft("");
    setActive(-1);
    setShow(false);
  }
  return (
    <div className="form-picker">
      <label htmlFor={id}>Tags</label>
      <div className="chip-field">
        {tags.map((t) => (
          <span className="input-chip" key={t}>
            {t}
            <button
              type="button"
              aria-label={"Remove " + t}
              onClick={() => {
                setTags(tags.filter((x) => x !== t));
                setError("");
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          role="combobox"
          aria-expanded={!!matches.length}
          aria-controls={id + "list"}
          aria-autocomplete="list"
          aria-activedescendant={matches[active] ? id + active : undefined}
          aria-describedby={id + "status"}
          placeholder="Add a tag…"
          value={draft}
          onFocus={() => setShow(true)}
          onBlur={() => setShow(false)}
          onChange={(e) => {
            const parts = e.target.value.split(/\s+/);
            const last = parts.pop()!;
            if (parts.length) commit(parts.join(" "));
            else setError("");
            setDraft(last);
            setShow(true);
            setActive(-1);
          }}
          onPaste={(e) => {
            e.preventDefault();
            const input = e.currentTarget;
            commit(
              draft.slice(0, input.selectionStart ?? 0) +
                e.clipboardData.getData("text") +
                draft.slice(input.selectionEnd ?? draft.length),
            );
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              commit(
                e.key === "Enter" && matches[active] ? matches[active] : draft,
              );
            }
            if (e.key === "Backspace" && !draft) {
              setTags(tags.slice(0, -1));
              setError("");
            }
            if (
              matches.length &&
              (e.key === "ArrowDown" || e.key === "ArrowUp")
            ) {
              e.preventDefault();
              setActive(
                Math.max(
                  0,
                  Math.min(
                    matches.length - 1,
                    active + (e.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            }
            if (matches.length && e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setShow(false);
              setActive(-1);
            }
          }}
        />
      </div>
      <div
        role="listbox"
        id={id + "list"}
        aria-label="Suggested tags"
        className="option-panel"
        hidden={!matches.length}
      >
        {matches.map((t, i) => (
          <div
            role="option"
            key={t}
            id={id + i}
            aria-selected={active === i}
            data-active={active === i}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => commit(t)}
          >
            {t}
          </div>
        ))}
      </div>
      <small role="status" id={id + "status"}>
        {error}
      </small>
    </div>
  );
}
