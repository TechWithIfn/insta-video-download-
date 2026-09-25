"use client";

import { useState, useCallback, useEffect } from "react";
import {
  ChevronDown,
  ShieldCheck,
  Mail,
  Play,
  Film,
  Image as ImageIcon,
  Clock,
  Star,
  Music,
  ArrowRight,
  ArrowDown,
} from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ScrollReveal from "@/components/ScrollReveal";
import { useLanguage } from "@/i18n";
import { SUPPORT_EMAIL, SUPPORT_GMAIL_URL } from "@/config/site";

const TYPE_ICONS = [Play, Film, ImageIcon, Clock, Star, Music];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[24px] font-bold tracking-[-0.01em] text-fg sm:text-[26px]">
      {children}
    </h2>
  );
}

function Accordion({
  items,
  idPrefix,
}: {
  items: { q: string; a: string }[];
  idPrefix: string;
}) {
  const [openIndex, setOpenIndex] = useState(0);
  const toggle = useCallback((i: number) => {
    setOpenIndex((prev) => (prev === i ? -1 : i));
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <div
            key={i}
            className="rounded-2xl transition-all duration-200"
            style={{
              background: isOpen ? "var(--accent-tint-purple)" : "var(--card)",
              border: isOpen
                ? "1px solid var(--accent-tint-purple-border)"
                : "1px solid var(--border)",
              boxShadow: isOpen ? "none" : "var(--shadow-card)",
            }}
          >
            <button
              type="button"
              onClick={() => toggle(i)}
              aria-expanded={isOpen}
              aria-controls={`${idPrefix}-answer-${i}`}
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
              id={`${idPrefix}-answer-${i}`}
              role="region"
              className="overflow-hidden transition-all duration-300"
              style={{
                maxHeight: isOpen ? 300 : 0,
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
  );
}

export default function HelpClient() {
  const { t } = useLanguage();
  const h = t.help;
  const typeNames = [t.tabs.reels, t.tabs.videos, t.tabs.photos, t.tabs.stories, t.tabs.audio];

  useEffect(() => {
    try {
      document.title = h.metaTitle;
    } catch {
      /* non-DOM environment */
    }
  }, [h.metaTitle]);

  return (
    <>
      <Header />
      <main className="flex-1">
        <section className="relative overflow-hidden pb-8 pt-8 sm:pt-12">
          <div className="absolute inset-0 -z-10">
            <div className="absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/[0.03] blur-[160px]" />
          </div>
          <div className="mx-auto max-w-[800px] px-4 text-center sm:px-6">
            <h1
              className="animate-fade-in-up font-bold tracking-[-0.02em] text-fg"
              style={{ fontSize: "clamp(32px, 6vw, 56px)", lineHeight: 1.1 }}
            >
              {h.title}
            </h1>
            <p className="animate-fade-in-up delay-100 mx-auto mt-4 max-w-[560px] text-[16px] leading-[1.7] text-fg-muted sm:text-[18px]">
              {h.subtitle}
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-[800px] px-4 pb-20 sm:px-6">
          {/* ── 1. Getting started ── */}
          <ScrollReveal>
            <section className="mt-10 rounded-[24px] p-7 sm:p-9" style={{ background: "var(--card)", boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}>
              <SectionTitle>{h.s1title}</SectionTitle>
              <ol className="mt-6 flex flex-col gap-4">
                {h.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3.5">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[14px] font-bold text-white"
                      style={{ background: "var(--brand-gradient)" }}
                    >
                      {i + 1}
                    </span>
                    <p className="pt-1 text-[16px] leading-[1.65] text-fg-muted">{step}</p>
                  </li>
                ))}
              </ol>
            </section>
          </ScrollReveal>

          {/* ── 2. Supported content ── */}
          <ScrollReveal>
            <section className="mt-8 rounded-[24px] p-7 sm:p-9" style={{ background: "var(--card)", boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}>
              <SectionTitle>{h.s2title}</SectionTitle>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {typeNames.map((name, i) => {
                  const Icon = TYPE_ICONS[i];
                  return (
                    <div
                      key={name}
                      className="flex items-center gap-2.5 rounded-2xl p-4"
                      style={{ background: "var(--bg)" }}
                    >
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                        style={{ background: "var(--accent-tint-purple)", border: "1px solid var(--accent-tint-purple-border)" }}
                      >
                        <Icon size={17} color="var(--primary)" strokeWidth={2} />
                      </span>
                      <span className="text-[14px] font-bold text-fg">{name}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-5 text-[14px] leading-[1.7] text-fg-muted">{h.s2note}</p>
            </section>
          </ScrollReveal>

          {/* ── 3. How it works ── */}
          <ScrollReveal>
            <section className="mt-8 rounded-[24px] p-7 sm:p-9" style={{ background: "var(--card)", boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}>
              <SectionTitle>{h.s3title}</SectionTitle>
              <p className="mt-3 text-[16px] leading-[1.7] text-fg-muted">{h.s3desc}</p>
              <div className="mt-6 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                {h.flow.map((step, i) => (
                  <div key={i} className="flex flex-col items-center gap-2 sm:flex-1 sm:flex-row sm:justify-center">
                    <span
                      className="w-full rounded-xl px-4 py-3 text-center text-[14px] font-bold text-white sm:w-auto sm:flex-1"
                      style={{ background: "var(--brand-gradient)" }}
                    >
                      {step}
                    </span>
                    {i < h.flow.length - 1 && (
                      <>
                        <ArrowDown className="h-4 w-4 shrink-0 text-fg-subtle sm:hidden" />
                        <ArrowRight className="hidden h-4 w-4 shrink-0 text-fg-subtle sm:block" />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </ScrollReveal>

          {/* ── 4. Audio ── */}
          <ScrollReveal>
            <section className="mt-8 rounded-[24px] p-7 sm:p-9" style={{ background: "var(--card)", boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}>
              <SectionTitle>{h.s4title}</SectionTitle>
              <ol className="mt-6 flex flex-col gap-4">
                {h.s4steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3.5">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[14px] font-bold text-white"
                      style={{ background: "var(--brand-gradient)" }}
                    >
                      {i + 1}
                    </span>
                    <p className="pt-1 text-[16px] leading-[1.65] text-fg-muted">{step}</p>
                  </li>
                ))}
              </ol>
            </section>
          </ScrollReveal>

          {/* ── 5. Troubleshooting ── */}
          <ScrollReveal>
            <section className="mt-8">
              <div className="mb-5 px-1">
                <SectionTitle>{h.s5title}</SectionTitle>
              </div>
              <Accordion items={h.problems} idPrefix="help-trouble" />
            </section>
          </ScrollReveal>

          {/* ── 6. Privacy ── */}
          <ScrollReveal>
            <section className="mt-8 rounded-[24px] p-7 sm:p-9" style={{ background: "var(--card)", boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}>
              <SectionTitle>{h.s6title}</SectionTitle>
              <ul className="mt-6 flex flex-col gap-3.5">
                {h.privacy.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--primary)" }} strokeWidth={2} />
                    <p className="text-[16px] leading-[1.65] text-fg-muted">{item}</p>
                  </li>
                ))}
              </ul>
            </section>
          </ScrollReveal>

          {/* ── 7. FAQ ── */}
          <ScrollReveal>
            <section className="mt-8">
              <div className="mb-5 px-1">
                <SectionTitle>{h.s7title}</SectionTitle>
              </div>
              <Accordion items={h.faq} idPrefix="help-faq" />
            </section>
          </ScrollReveal>

          {/* ── 8. Email support ── */}
          <ScrollReveal>
            <section
              className="mt-8 rounded-[24px] p-8 text-center sm:p-10"
              style={{ background: "var(--card)", boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}
            >
              <h2 className="text-[24px] font-bold text-fg sm:text-[26px]">{h.supportTitle}</h2>
              <p className="mx-auto mt-3 max-w-[420px] text-[16px] leading-[1.7] text-fg-muted">
                {h.supportDesc}
              </p>
              <a href={SUPPORT_GMAIL_URL} target="_blank" rel="noopener noreferrer" className="gradient-btn mt-6 min-h-[48px] px-8 text-[16px]">
                <Mail className="h-5 w-5" />
                {h.supportBtn}
              </a>
              <p className="mt-4 text-[14px] text-fg-muted">
                <a
                  href={SUPPORT_GMAIL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center justify-center break-all font-medium transition-colors hover:text-primary"
                >
                  {SUPPORT_EMAIL}
                </a>
              </p>
            </section>
          </ScrollReveal>
        </div>
      </main>
      <Footer />
    </>
  );
}
