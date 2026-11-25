import { translate } from "./i18n";
import { useState, useId, useEffect, useRef } from "react";

export function NumericInput({
  value,
  onChange,
  min,
  max,
  decimal = false,
  onValidity,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  decimal?: boolean;
  onValidity?: (valid: boolean) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);
  const id = useId();
  const text = draft ?? String(value);
  function parse(raw: string) {
    const normalized = raw.trim().replace(",", ".");
    const valid = (decimal ? /^(?:\d+(?:\.\d*)?|\.\d+)$/ : /^\d+$/).test(
      normalized,
    );
    const number = Number(normalized);
    return valid && number >= min && number <= max ? number : null;
  }
  const hint = translate(decimal ? "numberRange" : "integerRange", {
    min,
    max,
  });
  const input = useRef<HTMLInputElement>(null);
  const valid = parse(text) !== null;
  useEffect(() => {
    input.current?.setCustomValidity(valid ? "" : hint);
  }, [valid, hint]);
  const invalid = showError && !valid;
  return (
    <>
      <input
        ref={input}
        className="numeric-input"
        type="text"
        inputMode={decimal ? "decimal" : "numeric"}
        required
        value={text}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? id : undefined}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          const parsed = parse(raw);
          setDraft(raw);
          onValidity?.(parsed !== null);
          e.currentTarget.setCustomValidity(parsed === null ? hint : "");
          if (parsed !== null) onChange(parsed);
        }}
        onInvalid={() => setShowError(true)}
        onBlur={() => {
          if (parse(text) === null) setShowError(true);
          else {
            setDraft(null);
            setShowError(false);
          }
        }}
      />
      {invalid && (
        <small className="numeric-error" id={id}>
          {hint}
        </small>
      )}
    </>
  );
}
