"use client";

import { useState, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { useLanguage } from "@/i18n";

export default function FAQ() {
  const { t } = useLanguage();
  const [openIndex, setOpenIndex] = useState(0);

  const toggle = useCallback((i: number) => {
    setOpenIndex((prev) => (prev === i ? -1 : i));
  }, []);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: t.faq.items.map((item) => ({
              "@type": "Question",
              name: item.q,
              acceptedAnswer: { "@type": "Answer", text: item.a },
            })),
          }),
        }}
      />
      <section id="faq" className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8" aria-label={t.faq.title}>
      <div className="mx-auto max-w-[720px]">
        <div className="mb-14 text-center">
          <p className="mb-3 text-[14px] font-bold uppercase tracking-[0.12em] text-primary-strong">
            {t.faq.eyebrow}
          </p>
          <h2 className="text-[28px] font-bold tracking-[-0.02em] text-fg sm:text-[40px]">
            {t.faq.title}
          </h2>
          <p className="mx-auto mt-4 max-w-[400px] text-[18px] leading-relaxed text-fg-muted">
            {t.faq.subtitle}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {t.faq.items.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <div
                key={i}
                className="rounded-2xl transition-all duration-200"
                style={{
                  background: isOpen ? "var(--accent-tint-purple)" : "var(--card)",
                  border: isOpen ? "1px solid var(--accent-tint-purple-border)" : "1px solid var(--border)",
                  boxShadow: isOpen ? "none" : "var(--shadow-card)",
                }}
              >
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  id={`faq-question-${i}`}
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${i}`}
                  className="flex w-full items-center justify-between gap-4 py-5 px-6 text-left transition-colors"
                >
                  <span className="text-[16px] font-semibold text-fg pr-2">{item.q}</span>
                  <ChevronDown
                    className="h-[18px] w-[18px] shrink-0 transition-transform duration-250"
                    style={{
                      color: "var(--fg-subtle)",
                      transform: isOpen ? "rotate(180deg)" : "rotate(0)",
                    }}
                  />
                </button>
                <div
                  id={`faq-answer-${i}`}
                  aria-labelledby={`faq-question-${i}`}
                  className="overflow-hidden transition-all duration-300"
                  style={{
                    maxHeight: isOpen ? 200 : 0,
                    opacity: isOpen ? 1 : 0,
                    padding: isOpen ? "0 24px 20px" : "0 24px",
                  }}
                >
                  <p className="text-[14px] leading-[1.65] text-fg-muted">{item.a}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </section>
    </>
  );
}
