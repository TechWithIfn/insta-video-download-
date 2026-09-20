"use client";

import { Play, Film, Image, Layers, Clock, Star, Music } from "lucide-react";
import { useLanguage } from "@/i18n";

const ICONS = [Play, Film, Image, Layers, Clock, Star, Music];
const TINTS = ["purple", "purple", "purple", "orange", "orange", "orange", "orange"] as const;

const tintStyles = {
  purple: {
    bg: "var(--accent-tint-purple)",
    border: "var(--accent-tint-purple-border)",
    iconColor: "var(--primary)",
  },
  orange: {
    bg: "var(--accent-tint-orange)",
    border: "var(--accent-tint-orange-border)",
    iconColor: "#c77a1f",
  },
};

export default function Features() {
  const { t } = useLanguage();

  return (
    <section
      id="features"
      className="px-5 py-20 sm:px-6 sm:py-28 lg:px-8"
      aria-label={t.nav.features}
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-14 text-center">
          <p
            className="mb-3 text-[13px] font-bold uppercase tracking-[0.12em]"
            style={{ background: "var(--brand-gradient-text)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}
          >
            {t.features.eyebrow}
          </p>
          <h2 className="text-3xl font-bold tracking-[-0.02em] text-fg sm:text-[40px]">
            {t.features.title}
          </h2>
          <p className="mx-auto mt-4 max-w-[480px] text-[17px] leading-relaxed text-fg-muted">
            {t.features.subtitle}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 max-w-[1000px] mx-auto">
          {t.features.items.map((card, i) => {
            const tint = TINTS[i];
            const s = tintStyles[tint];
            const Icon = ICONS[i];
            return (
              <div
                key={i}
                className="group rounded-[20px] bg-card p-7 shadow-[var(--shadow-card)] transition-all duration-300 hover:-translate-y-[3px] hover:shadow-[var(--shadow-card-hover)]"
                style={{ border: "1px solid var(--border)" }}
              >
                <div
                  className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{ background: s.bg, border: `1px solid ${s.border}` }}
                >
                  <Icon size={20} color={s.iconColor} strokeWidth={2} />
                </div>
                <h3 className="text-[18px] font-bold text-fg">{card.title}</h3>
                <p className="mt-2 text-[14.5px] leading-[1.6] text-fg-muted">{card.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
