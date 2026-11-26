import { LegalLinks } from "../legal";
import { translate } from "../i18n";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { LanguageSwitch } from "../i18n/LanguageSwitch";
import { Logo } from "../components";

export const ratingLabels = [
  "rating1",
  "rating2",
  "rating3",
  "rating4",
  "rating5",
] as const;

const faq = [
  ["faqTopic", "faqTopicAnswer"],
  ["faqReview", "faqReviewAnswer"],
  ["faqDates", "faqDatesAnswer"],
  ["faqCalendar", "faqCalendarAnswer"],
  ["faqLogin", "faqLoginAnswer"],
] as const;

function Tagline() {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          element.classList.add("revealed");
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    element.classList.add("reveal-ready");
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  let word = 0;
  return (
    <p className="tagline" ref={ref}>
      {[translate("forgetting"), translate("rightTime")].map((line) => (
        <span className="tagline-line" key={line}>
          {line.split(" ").map((w) => (
            <span key={word++} style={{ transitionDelay: word * 65 + "ms" }}>
              {w}{" "}
            </span>
          ))}
        </span>
      ))}
    </p>
  );
}

export function Landing({
  theme,
  cta,
  feedback,
}: {
  theme: ReactNode;
  cta: ReactNode;
  feedback: ReactNode;
}) {
  const [rating, setRating] = useState<number | null>(null);
  return (
    <div className="landing">
      <header>
        <div>
          <Logo />
          <small>{translate("strapline")}</small>
        </div>
        <div className="top-actions">
          <LanguageSwitch />
          {theme}
        </div>
      </header>
      <main>
        <section className="landing-grid">
          <div>
            <h1>{translate("hero")}</h1>
            <p className="intro">{translate("intro")}</p>
            {cta}
            {feedback}
            <p className="fine-print">{translate("calendarOptional")}</p>
          </div>
          <div className="product-example" aria-label={translate("demo")}>
            <h2>{translate("chainRule")}</h2>
            <p>{translate("demoFirst")}</p>
            <div className="rating-options">
              {ratingLabels.map((r, i) => (
                <button
                  type="button"
                  className="button"
                  key={r}
                  aria-pressed={rating === i}
                  onClick={() => setRating(i)}
                >
                  <span>{i + 1}</span>
                  {translate(r)}
                </button>
              ))}
            </div>
            {rating !== null && (
              <p role="status">
                {rating <= 1
                  ? translate("demoSoon")
                  : rating === 2
                    ? translate("demoPractice")
                    : translate("demoLater")}
              </p>
            )}
          </div>
        </section>
        <Tagline />
        <section className="landing-section">
          <h2>{translate("howItWorks")}</h2>
          <ol className="step-list">
            <li>
              <h3>{translate("stepAdd")}</h3>
              {translate("stepAddCopy")}
            </li>
            <li>
              <h3>{translate("stepReview")}</h3>
              {translate("stepReviewCopy")}
            </li>
            <li>
              <h3>{translate("stepRate")}</h3>
              {translate("stepRateCopy")}
            </li>
          </ol>
        </section>
        <section className="landing-section">
          <h2>{translate("benefits")}</h2>
          <ul>
            <li>{translate("benefitRecall")}</li>
            <li>{translate("benefitTime")}</li>
            <li>{translate("benefitHours")}</li>
          </ul>
        </section>
        <section className="landing-section">
          <h2>{translate("faqHeading")}</h2>
          {faq.map(([q, a]) => (
            <details key={q}>
              <summary>{translate(q)}</summary>
              <p>{translate(a)}</p>
            </details>
          ))}
        </section>
        <div className="landing-section">{cta}</div>
      </main>
      <footer>
        <LegalLinks />
        <span>Blind Spot Interval</span>

        <address>
          <a href="https://t.me/aabdunazirov">Telegram: @aabdunazirov</a>
          <a href="mailto:abdulatifabdunazirov@gmail.com">
            {translate("email")}
          </a>
        </address>
      </footer>
    </div>
  );
}
