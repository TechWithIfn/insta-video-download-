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
import { Zap, ShieldCheck, Clock, Smartphone, LayoutGrid, ListOrdered, FileText } from "lucide-react";

const QUICK_ICONS = [Zap, ShieldCheck, Clock, Smartphone];

export default function HomeClient() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<DownloaderTab | null>(null);

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (requestedTab === "reels" || requestedTab === "videos" || requestedTab === "photos" || requestedTab === "stories" || requestedTab === "audio") {
      queueMicrotask(() => setActiveTab(requestedTab));
    }
  }, []);

  const handleDownloaderTabChange = (tab: DownloaderTab | null) => {
    setActiveTab(tab);
    if (tab) {
      document.getElementById("hero")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                      style={{ background: "var(--accent-tint-purple)", border: "1px solid var(--accent-tint-purple-border)" }}
                    >
                      <Icon size={18} color="var(--primary)" strokeWidth={2} />
                    </div>
                    <div>
                      <p className="text-[14px] font-bold text-fg">{f.title}</p>
                      <p className="mt-0.5 text-[14px] text-fg-subtle">{f.desc}</p>
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

        {/* ── SEO Content: useful, original, keyword-natural (no stuffing) ── */}
        <ScrollReveal>
          <section className="mx-auto max-w-[900px] px-5 sm:px-6 lg:px-12 py-12" aria-labelledby="about-downloadit">
            <div className="rounded-[24px] p-6 sm:p-8" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-card)" }}>
              <h2 id="about-downloadit" className="text-[28px] font-bold tracking-[-0.02em] text-fg">Public Instagram Reels, videos and photos — no login</h2>
              <p className="mt-3 text-[16px] leading-[1.7] text-fg-muted">
                Downloadit is a free Instagram downloader built for public content. Paste the link to an Instagram Reel, video post, photo post, story or highlight and Downloadit detects the media, shows you a preview, and lets you save it to your phone, tablet or desktop as MP4, JPG, PNG or MP3. No login, no app install, no account.
              </p>
              <p className="mt-3 text-[16px] leading-[1.7] text-fg-muted">
                Everything runs in your browser through one simple field: copy a public link, paste it, tap Get Media, then download what you see. Downloadit is an independent tool — it is not affiliated with, endorsed by, or sponsored by Instagram or Meta.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl p-5 shadow-[var(--shadow-card)]" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "var(--accent-tint-purple)", border: "1px solid var(--accent-tint-purple-border)" }}>
                    <LayoutGrid size={18} color="var(--primary)" strokeWidth={2} aria-hidden="true" />
                  </div>
                  <h3 className="mt-3 text-[16px] font-bold text-fg">What you can download</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-[1.7] text-fg-muted">
                    <li><a href="/instagram-reels-downloader" className="font-bold text-primary hover:underline">Instagram Reels Downloader</a> — Download Instagram Reels in full quality as MP4.</li>
                    <li><a href="/instagram-video-downloader" className="font-bold text-primary hover:underline">Instagram Video Downloader</a> — Download Instagram Videos and long-form clips as MP4.</li>
                    <li><a href="/instagram-photo-downloader" className="font-bold text-primary hover:underline">Instagram Photo Downloader</a> — save single photos and every image of a multi-photo post at original resolution.</li>
                    <li><a href="/instagram-story-downloader" className="font-bold text-primary hover:underline">Instagram Story Downloader</a> — save public stories before they expire.</li>
                    <li><a href="/instagram-audio-downloader" className="font-bold text-primary hover:underline">Instagram Audio Downloader</a> — extract the sound of a Reel or video as MP3.</li>
                  </ul>
                </div>
                <div className="rounded-2xl p-5 shadow-[var(--shadow-card)]" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "var(--accent-tint-purple)", border: "1px solid var(--accent-tint-purple-border)" }}>
                    <ListOrdered size={18} color="var(--primary)" strokeWidth={2} aria-hidden="true" />
                  </div>
                  <h3 className="mt-3 text-[16px] font-bold text-fg">How downloading works</h3>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-[14px] leading-[1.7] text-fg-muted">
                    <li><strong className="text-fg">Copy</strong> the public link to the Reel, video, photo or story you want.</li>
                    <li><strong className="text-fg">Paste</strong> it into Downloadit and tap Get Media — no login required.</li>
                    <li><strong className="text-fg">Preview and save</strong> the detected media to your device.</li>
                  </ol>
                </div>
                <div className="rounded-2xl p-5 shadow-[var(--shadow-card)]" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "var(--accent-tint-purple)", border: "1px solid var(--accent-tint-purple-border)" }}>
                    <FileText size={18} color="var(--primary)" strokeWidth={2} aria-hidden="true" />
                  </div>
                  <h3 className="mt-3 text-[16px] font-bold text-fg">Supported formats and devices</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-[1.7] text-fg-muted">
                    <li><strong className="text-fg">Video</strong> → MP4, straight to your device.</li>
                    <li><strong className="text-fg">Photos</strong> → JPG, PNG or WebP.</li>
                    <li><strong className="text-fg">Audio</strong> → MP3 from Reels and videos.</li>
                    <li><strong className="text-fg">Devices</strong> → mobile, tablet and desktop, straight from the browser.</li>
                  </ul>
                </div>
                <div className="rounded-2xl p-5 shadow-[var(--shadow-card)]" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "var(--accent-tint-purple)", border: "1px solid var(--accent-tint-purple-border)" }}>
                    <ShieldCheck size={18} color="var(--primary)" strokeWidth={2} aria-hidden="true" />
                  </div>
                  <h3 className="mt-3 text-[16px] font-bold text-fg">Privacy and private content</h3>
                  <p className="mt-2 text-[14px] leading-[1.7] text-fg-muted">
                    Downloadit never asks for your Instagram password or cookies, and it never bypasses access controls. Private, deleted or expired content simply returns a clear message instead of a broken file. See <a href="/privacy" className="text-primary hover:underline">Privacy</a>, <a href="/help" className="text-primary hover:underline">Help</a> and <a href="/terms" className="text-primary hover:underline">Terms</a>.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </ScrollReveal>

        <ScrollReveal><FAQ /></ScrollReveal>
      </main>
      <Footer />
    </>
  );
}
