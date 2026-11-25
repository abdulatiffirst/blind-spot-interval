import { getLanguage, setLanguage, translate, type Language } from "./index";
export function LanguageSwitch({
  onSelect = setLanguage,
  disabled = false,
}: {
  onSelect?: (language: Language) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="language-switch"
      role="group"
      aria-label={translate("language")}
    >
      {(["en", "ru"] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          lang={lang}
          aria-label={lang === "en" ? "English" : "Русский"}
          aria-pressed={getLanguage() === lang}
          disabled={disabled}
          onClick={() => {
            if (getLanguage() !== lang) onSelect(lang);
          }}
        >
          {lang.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
