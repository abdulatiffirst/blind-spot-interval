import type { ReactNode } from "react";
import { translate, useLanguage, type Language } from "./i18n";

const forms: Record<Language, string> = {
  en: "https://docs.google.com/forms/d/e/1FAIpQLSfufB9hksgREvOqXahEO6Ufs5OTzNDDgwQYpagCkeOqAzwM_Q/viewform?usp=dialog",
  ru: "https://docs.google.com/forms/d/e/1FAIpQLScKvWlsFzutGVLaXLpzFrDYzdzsxy3Q47xGChvaFZV2Drg4Lw/viewform?usp=dialog",
};

export function FeedbackLink({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const language = useLanguage();
  return (
    <a
      href={forms[language]}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
      <span>{translate("feedbackLink")}</span>
    </a>
  );
}
