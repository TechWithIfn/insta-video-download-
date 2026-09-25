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

        {/* ── SEO Content: useful, original, keyword-natural (no stuffing) ── */}
        <ScrollReveal>
          <section className="mx-auto max-w-[900px] px-5 sm:px-6 lg:px-12 py-12" aria-labelledby="about-downloadit">
            <div className="rounded-[24px] p-6 sm:p-8" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-card)" }}>
              <h2 id="about-downloadit" className="text-[24px] font-bold tracking-[-0.02em] text-fg sm:text-[28px]">Download Instagram content without login</h2>
              <p className="mt-3 text-[15px] leading-[1.7] text-fg-muted">
                Downloadit is a fast Instagram downloader that lets you save public Instagram Reels, videos, photos, stories and audio to your phone or desktop. Paste a public link, preview the media, and save it as MP4, JPG or MP3 — no login, no app install, and no account required.
              </p>
              <div className="mt-6 grid gap-6">
                <div>
                  <h3 className="text-[16px] font-bold text-fg">What you can download</h3>
                  <ul className="mt-2 list-disc pl-5 text-[14.5px] leading-[1.7] text-fg-muted">
                    <li><strong className="text-fg">Instagram Reels downloader online</strong> — save trending Reels as MP4. Use Downloadit as an Instagram reel saver to keep short vertical videos for offline viewing. <a href="/instagram-reels-downloader" className="text-primary hover:underline">Instagram Reels Downloader</a></li>
                    <li><strong className="text-fg">Instagram video downloader</strong> — download standard feed videos and save Instagram videos to phone. Converts Instagram video to MP4 in HD. <a href="/instagram-video-downloader" className="text-primary hover:underline">Instagram Video Downloader</a></li>
                    <li><strong className="text-fg">Instagram photo downloader</strong> — save Instagram photos and images in original quality. Supports single photos and image posts. <a href="/instagram-photo-downloader" className="text-primary hover:underline">Instagram Photo Downloader</a></li>
                    <li><strong className="text-fg">Instagram story downloader</strong> — save public stories before they expire. Works as an Instagram story saver for images and videos. <a href="/instagram-story-downloader" className="text-primary hover:underline">Instagram Story Downloader</a></li>
                    <li><strong className="text-fg">Instagram audio downloader</strong> — extract audio from Reels and videos and download as MP3. Also works as Instagram music downloader and reel audio downloader. <a href="/instagram-audio-downloader" className="text-primary hover:underline">Instagram Audio Downloader</a></li>
                  </ul>
                </div>
                <div>
                  <h3 className="text-[16px] font-bold text-fg">How downloading works</h3>
                  <p className="mt-2 text-[14.5px] leading-[1.7] text-fg-muted">
                    Copy a public Instagram post link, paste it into Downloadit, and tap Get Media. The backend validates the URL, detects whether it’s a Reel, video, photo, story or audio, and returns a preview you can download. No-login workflow means you never share your Instagram password — the tool works only with links you can already view publicly in a browser.
                  </p>
                </div>
                <div>
                  <h3 className="text-[16px] font-bold text-fg">Supported formats and devices</h3>
                  <p className="mt-2 text-[14.5px] leading-[1.7] text-fg-muted">
                    Reels and videos → MP4 (Instagram MP4 download), photos → JPG/PNG/WebP (Instagram image download), audio → MP3 (Instagram MP3 download). Works on mobile, tablet and desktop. Save Instagram reels to phone or download Instagram photos to phone directly in your browser — free, fast, and online. If you searched for an insta downloader, insta video download, or insta reels download tool, this single page covers all of them: paste any public link and save it to your device.
                  </p>
                </div>
                <div>
                  <h3 className="text-[16px] font-bold text-fg">Privacy and private content</h3>
                  <p className="mt-2 text-[14.5px] leading-[1.7] text-fg-muted">
                    Downloadit never asks for your Instagram login and never bypasses private settings. If content is private, deleted, Close Friends, or not publicly accessible, the backend returns a clear category (private/expired/restricted) instead of faking a download. Links are temporary and expire quickly — download while available. See <a href="/privacy" className="text-primary hover:underline">Privacy</a>, <a href="/help" className="text-primary hover:underline">Help</a> and <a href="/terms" className="text-primary hover:underline">Terms</a> for details.
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
