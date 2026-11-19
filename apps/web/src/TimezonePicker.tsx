import { useEffect, useId, useMemo, useRef, useState } from "react";
import { zoneOptions, zoneOption } from "./form-options";
function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  return !q || i < 0 ? (
    text
  ) : (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}
export function TimezonePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [index, setIndex] = useState(0);
  const id = useId(),
    root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const options = useMemo(
    () => (open ? zoneOptions(value) : []),
    [open, value],
  );
  const selectedLabel = useMemo(() => {
    try {
      return zoneOption(value, new Date()).label;
    } catch {
      return value;
    } // Keep older saved values editable if Intl does not recognize them.
  }, [value]);
  const q = query
      .trim()
      .replaceAll("−", "-")
      .replace(/([+-])(\d)(?=:|$)/, "$10$2"),
    matches = options.filter((o) =>
      (o.label + " " + o.id).toLowerCase().includes(q.toLowerCase()),
    );
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function choose(i: number) {
    if (matches[i]) {
      onChange(matches[i].id);
      close();
    }
  }
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open)
      document.getElementById(id + index)?.scrollIntoView({ block: "nearest" });
  }, [index, open, id]);
  return (
    <div
      className="form-picker"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <label id={id + "label"} htmlFor={id + "button"}>
        Timezone
      </label>
      <button
        type="button"
        id={id + "button"}
        ref={trigger}
        className="zone-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setQuery("");
            setIndex(0);
            setOpen(true);
          }
        }}
        onClick={() => {
          setQuery("");
          setIndex(0);
          setOpen(!open);
        }}
      >
        {selectedLabel}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="option-panel">
          <input
            autoFocus
            aria-label="Search timezones"
            role="combobox"
            aria-controls={id}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-activedescendant={matches[index] ? id + index : undefined}
            placeholder="Search city, region or UTC offset"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
              if (e.key === "Enter") {
                e.preventDefault();
                choose(index);
              }
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setIndex(
                  Math.max(
                    0,
                    Math.min(
                      matches.length - 1,
                      index + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
              }
            }}
          />
          <div role="listbox" id={id} aria-labelledby={id + "label"}>
            {matches.map((o, i) => (
              <div
                role="option"
                key={o.id}
                id={id + i}
                aria-selected={o.id === value}
                data-active={i === index}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                {highlight(o.label, q)}
                <small>{highlight(o.id, q)}</small>
              </div>
            ))}
          </div>
          {!matches.length && (
            <small role="status">No matching timezones</small>
          )}
        </div>
      )}
    </div>
  );
}
