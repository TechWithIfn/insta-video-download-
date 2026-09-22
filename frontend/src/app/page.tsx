"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import HeroDownloader, { type DownloaderTab } from "@/components/HeroDownloader";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import FAQ from "@/components/FAQ";
import Footer from "@/components/Footer";
import ScrollReveal from "@/components/ScrollReveal";
import { useLanguage } from "@/i18n";
import { Zap, ShieldCheck, Clock, Smartphone } from "lucide-react";

const QUICK_ICONS = [Zap, ShieldCheck, Clock, Smartphone];

export default function Home() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<DownloaderTab>("reels");

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (requestedTab === "reels" || requestedTab === "videos" || requestedTab === "photos" || requestedTab === "audio") {
      queueMicrotask(() => setActiveTab(requestedTab));
    }
  }, []);

  const handleDownloaderTabChange = (tab: DownloaderTab) => {
    setActiveTab(tab);
    document.getElementById("hero")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <Header activeDownloaderTab={activeTab} onDownloaderTabChange={handleDownloaderTabChange} />
      <main className="flex-1">
        <HeroDownloader activeTab={activeTab} onActiveTabChange={setActiveTab} />

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

        {/* ── Full Sections (single hierarchy, no duplicates) ── */}
        <ScrollReveal><Features /></ScrollReveal>
        <ScrollReveal><HowItWorks /></ScrollReveal>
        <ScrollReveal><FAQ /></ScrollReveal>
      </main>
      <Footer />
    </>
  );
}
