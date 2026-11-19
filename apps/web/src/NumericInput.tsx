import { useState, useId } from "react";

export function NumericInput({
  value,
  onChange,
  min,
  max,
  decimal = false,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  decimal?: boolean;
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
  const hint = `Enter ${decimal ? "a number" : "a whole number"} from ${min} to ${max}.`;
  const invalid = showError && parse(text) === null;
  return (
    <>
      <input
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
