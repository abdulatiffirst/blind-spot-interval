import { useTheme } from "./useTheme";
import { useEffect, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { Logo } from "./components";
import { LanguageSwitch } from "./i18n/LanguageSwitch";
import { translate, useLanguage } from "./i18n";
import { Button } from "./ui";
import { legalCopy } from "./legal-copy";

const paths = {
  "/privacy": "privacyPolicy",
  "/terms": "termsOfService",
  "/support": "supportCenter",
} as const;

export const legalPath = (pathname: string) => {
  const path = pathname.replace(/\/$/, "");
  return Object.hasOwn(paths, path) ? (path as keyof typeof paths) : null;
};

export function LegalLinks({
  current,
  children,
}: {
  current?: keyof typeof paths;
  children?: ReactNode;
}) {
  useLanguage();
  return (
    <nav className="legal-links" aria-label={translate("legalNavigation")}>
      {Object.entries(paths).map(([path, label]) => (
        <a
          key={path}
          href={path}
          aria-current={path === current ? "page" : undefined}
        >
          {translate(label)}
        </a>
      ))}
      {children}
    </nav>
  );
}

const email = "abdulatifabdunazirov@gmail.com";

export function LegalPage({ path }: { path: keyof typeof paths }) {
  const language = useLanguage();
  const { dark, toggleTheme } = useTheme();
  const title = translate(paths[path]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = title + " | Blind Spot Interval";
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", document.title);
  }, [language, title]);
  return (
    <div className="landing legal-page">
      <header>
        <a href="/" aria-label="Blind Spot Interval">
          <Logo />
        </a>
        <div className="top-actions">
          <LanguageSwitch />
          <Button
            className="icon-button"
            aria-label={translate("darkTheme")}
            aria-pressed={dark}
            onClick={toggleTheme}
          >
            {dark ? <Sun size={19} /> : <Moon size={19} />}
          </Button>
        </div>
      </header>
      <main>
        <h1>{title}</h1>
        {legalCopy[language][path].map(([heading, text]) => (
          <section key={heading}>
            <h2>{heading}</h2>
            <p>{text}</p>
          </section>
        ))}
        <section>
          <h2>{translate("legalContact")}</h2>
          <p>
            Abdulatif Abdunazirov · <a href={"mailto:" + email}>{email}</a>
          </p>
        </section>
      </main>
      <footer>
        <LegalLinks current={path} />
      </footer>
    </div>
  );
}
