import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Logo } from "../components";

export const ratingLabels = [
  "Forgot completely",
  "Mostly forgot",
  "Recalled with difficulty",
  "Good recall",
  "Effortless recall",
];

const faq = [
  [
    "What is a topic?",
    "Something you studied and want to remember, such as the chain rule.",
  ],
  [
    "What happens in a review?",
    "Explain the topic from memory. Check your notes, then rate what you remembered.",
  ],
  [
    "How are dates chosen?",
    "Your ratings help set the next review date. We look for a time inside your study hours.",
  ],
  [
    "Do I need Google Calendar?",
    "No. You can see all your reviews in the app.",
  ],
  [
    "Why Google sign in?",
    "Your Google account lets you return to your saved topics and reviews.",
  ],
  [
    "What does it cost and what happens to my data?",
    "{{pricing}} · {{privacy_summary}}",
  ],
];

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
      {[
        "Forgetting is normal.",
        "Reviewing at the right time is how you beat it.",
      ].map((line) => (
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
  return (
    <div className="landing">
      <header>
        <div>
          <Logo />
          <small>Spaced review for students.</small>
        </div>
        {theme}
      </header>
      <main>
        <section className="landing-grid">
          <div>
            <h1>Remember what you study.</h1>
            <p className="intro">
              Add a topic you just learned. Blind Spot Interval picks the best
              days to review it, so it sticks.
            </p>
            {cta}
            {feedback}
            <p className="fine-print">Google Calendar is optional.</p>
            <small>{"{{stat}}"}</small>
          </div>
          <div className="product-example" aria-hidden="true">
            <h2>Chain rule</h2>
            <p>First review: Sunday, 18:00</p>
            <div className="rating-options">
              {ratingLabels.map((r, i) => (
                <span className="button" key={r}>
                  <span>{i + 1}</span>
                  {r}
                </span>
              ))}
            </div>
          </div>
        </section>
        <Tagline />
        <section className="landing-section">
          <h2>How it works</h2>
          <ol className="step-list">
            <li>
              <h3>Add a topic</h3>Type a name, like Chain rule. That is all it
              needs.
            </li>
            <li>
              <h3>Review when it is time</h3>We schedule it inside your study
              hours. Reviews appear on Today and, if you want, in Google
              Calendar.
            </li>
            <li>
              <h3>Recall, then rate</h3>Try to explain it from memory, then rate
              how it went. Easy topics come back later. Hard ones come back
              sooner.
            </li>
          </ol>
        </section>
        <section className="landing-section">
          <h2>Benefits</h2>
          <ul>
            <li>Review only what is fading.</li>
            <li>Short sessions. The default review is 15 minutes.</li>
            <li>Fits your day. Reviews land inside the study hours you set.</li>
          </ul>
        </section>
        <section className="landing-section">
          <h2>Common questions</h2>
          {faq.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </section>
        <div className="landing-section">{cta}</div>
      </main>
      <footer>
        <span>Blind Spot Interval</span>
        <div className="inline wrap">
          <a href="{{privacy_url}}">Privacy</a>
          <a href="{{terms_url}}">Terms</a>
          <span>{"{{support_email}}"}</span>
        </div>
      </footer>
    </div>
  );
}
