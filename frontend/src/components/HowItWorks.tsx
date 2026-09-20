"use client";

import { Link2, Clipboard, Eye } from "lucide-react";
import { useLanguage } from "@/i18n";

const ICONS = [Link2, Clipboard, Eye];
const NUMS = ["01", "02", "03"];

export default function HowItWorks() {
  const { t } = useLanguage();

  return (
    <section
      id="how-it-works"
      className="px-5 py-20 sm:px-6 sm:py-28 lg:px-8"
      aria-label={t.nav.howItWorks}
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-14 text-center">
          <p
            className="mb-3 text-[13px] font-bold uppercase tracking-[0.12em]"
            style={{ background: "var(--brand-gradient-text)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}
          >
            {t.steps.eyebrow}
          </p>
          <h2 className="text-3xl font-bold tracking-[-0.02em] text-fg sm:text-[40px]">
            {t.steps.title}
          </h2>
          <p className="mx-auto mt-4 max-w-[420px] text-[17px] leading-relaxed text-fg-muted">
            {t.steps.subtitle}
          </p>
        </div>

        <div className="relative flex flex-col items-start justify-center sm:flex-row sm:items-start max-w-[1000px] mx-auto">
          {t.steps.items.map((step, i) => {
            const Icon = ICONS[i];
            return (
              <div key={NUMS[i]} className="flex items-center sm:flex-1">
                <div className="flex flex-1 flex-col items-center text-center px-4">
                  <p className="mb-5 text-[13px] font-bold uppercase tracking-[0.1em] text-accent">
                    {t.steps.stepWord} {NUMS[i]}
                  </p>
                  <div
                    className="mb-5 flex h-[70px] w-[70px] items-center justify-center rounded-[20px] text-white"
                    style={{ background: "var(--brand-gradient)", boxShadow: "var(--shadow-brand)" }}
                  >
                    <Icon size={28} strokeWidth={2} />
                  </div>
                  <h3 className="text-[20px] font-bold text-fg">{step.title}</h3>
                  <p className="mt-2.5 max-w-[260px] text-[15px] leading-[1.65] text-fg-muted">
                    {step.desc}
                  </p>
                </div>
                {/* Connector line */}
                {i < t.steps.items.length - 1 && (
                  <div
                    className="hidden sm:block h-px flex-shrink-0 mt-[22px]"
                    style={{
                      width: 120,
                      background: "linear-gradient(90deg, rgba(124,77,245,0.3), rgba(236,95,168,0.3))",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
