"use client";

import Header from "@/components/Header";
import HeroDownloader from "@/components/HeroDownloader";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import WhySnapSave from "@/components/WhySnapSave";
import FAQ from "@/components/FAQ";
import Footer from "@/components/Footer";
import ScrollReveal from "@/components/ScrollReveal";
import { useLanguage } from "@/i18n";
import { Zap, ShieldCheck, Clock, Smartphone, Link2, Clipboard, Eye } from "lucide-react";

const QUICK_ICONS = [Zap, ShieldCheck, Clock, Smartphone];
const WORKFLOW_ICONS = [Link2, Clipboard, Eye];
const WORKFLOW_NUMS = [1, 2, 3];

export default function Home() {
  const { t } = useLanguage();

  return (
    <>
      <Header />
      <main className="flex-1">
        <HeroDownloader />

        {/* ── Quick Feature Strip ── */}
        <ScrollReveal>
          <section className="mx-auto max-w-[1100px] px-5 sm:px-6 lg:px-12 mt-16">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {t.quick.items.map((f, i) => {
                const Icon = QUICK_ICONS[i];
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3.5 rounded-2xl p-[18px] shadow-[var(--shadow-card)]"
                    style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                  >
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]"
                      style={{ background: "var(--accent-tint-purple)", border: "1px solid var(--accent-tint-purple-border)" }}
                    >
                      <Icon size={18} color="var(--primary)" strokeWidth={2} />
                    </div>
                    <div>
                      <p className="text-[14px] font-bold text-fg">{f.title}</p>
                      <p className="mt-0.5 text-[13px] text-fg-subtle">{f.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </ScrollReveal>

        {/* ── Compact How It Works Panel ── */}
        <ScrollReveal>
          <section className="mx-auto max-w-[1100px] px-5 sm:px-6 lg:px-12 mt-12">
            <div
              className="rounded-[24px] p-8 sm:p-9"
              style={{ background: "var(--card)", boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}
            >
              <div className="mb-7 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h3 className="text-[22px] font-bold text-fg">{t.workflow.title}</h3>
                  <p className="mt-1 text-[15px] text-fg-muted">{t.workflow.subtitle}</p>
                </div>
                <a
                  href="#features"
                  className="text-[14px] font-semibold text-accent no-underline transition-opacity hover:opacity-80"
                >
                  {t.workflow.viewAll}
                </a>
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                {t.workflow.items.map((s, i) => {
                  const WIcon = WORKFLOW_ICONS[i];
                  return (
                    <div
                      key={WORKFLOW_NUMS[i]}
                      className="flex items-start gap-3.5 rounded-2xl p-[18px]"
                      style={{ background: "var(--bg)" }}
                    >
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[14px] font-bold text-white"
                        style={{ background: "var(--brand-gradient)" }}
                      >
                        {WORKFLOW_NUMS[i]}
                      </div>
                      <div>
                        <p className="flex items-center gap-1.5 text-[15px] font-bold text-fg">
                          <WIcon size={15} color="var(--primary)" strokeWidth={2.2} />
                          {s.title}
                        </p>
                        <p className="mt-0.5 text-[13.5px] text-fg-muted">{s.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </ScrollReveal>

        {/* ── Full Sections ── */}
        <ScrollReveal><Features /></ScrollReveal>
        <ScrollReveal><HowItWorks /></ScrollReveal>
        <ScrollReveal><WhySnapSave /></ScrollReveal>
        <ScrollReveal><FAQ /></ScrollReveal>
      </main>
      <Footer />
    </>
  );
}
