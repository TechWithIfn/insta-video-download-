import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/config/site";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: { absolute: "Instagram Audio Downloader – Save Audio as MP3 | Downloadit" },
  description: "Download Instagram audio as MP3 with Downloadit. Extract and save music or sound from public Reels and videos — no login required.",
  alternates: { canonical: "/instagram-audio-downloader" },
  openGraph: {
    title: { absolute: "Instagram Audio Downloader – Save Audio as MP3 | Downloadit" },
    description: "Download Instagram audio as MP3 with Downloadit. Extract and save music or sound from public Reels and videos — no login required.",
    url: `${SITE_URL}/instagram-audio-downloader`,
    type: "website",
    images: [{ url: "/og-downloadit.png", width: 1200, height: 630, alt: "Instagram Audio Downloader — Downloadit" }],
  },
  twitter: {
    card: "summary_large_image",
    title: { absolute: "Instagram Audio Downloader – Save Audio as MP3 | Downloadit" },
    description: "Download Instagram audio as MP3 with Downloadit. Extract and save music or sound from public Reels and videos — no login required.",
    images: ["/og-downloadit.png"],
  },
};

export default function AudioDownloaderPage() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <section className="mx-auto max-w-[900px] px-5 sm:px-6 lg:px-12 pt-8 sm:pt-12 pb-12">
          <h1 className="text-[32px] font-extrabold tracking-[-0.02em] text-fg sm:text-[42px] leading-[1.1]">Instagram Audio Downloader</h1>
          <p className="mt-4 text-[17px] leading-[1.7] text-fg-muted">
            Download Instagram audio as MP3 with Downloadit. Extract music and sound from public Reels and videos and save the audio track to your device — no login required.
          </p>
          <p className="mt-3 text-[15px] leading-[1.7] text-fg-muted">
            This audio extractor and MP3 converter works with public Instagram videos. Paste a Reels or video link, let Downloadit process the available stream on the backend, and download a clean MP3 of the Instagram sound.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/?tab=audio#hero" className="inline-flex min-h-[48px] items-center justify-center rounded-2xl px-6 text-[15px] font-bold text-white shadow-[var(--shadow-brand)]" style={{ background: "var(--brand-gradient)" }}>
              Download Audio — Paste Link
            </Link>
            <Link href="/" className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-border bg-card px-6 text-[15px] font-semibold text-fg hover:bg-primary-light">Back to Instagram Downloader</Link>
          </div>

          <div className="mt-12 grid gap-6 rounded-[24px] p-6 sm:p-8" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-card)" }}>
            <h2 className="text-[20px] font-bold text-fg">How the Instagram audio downloader works</h2>
            <ol className="list-decimal pl-5 space-y-2 text-[14.5px] leading-[1.7] text-fg-muted">
              <li><strong className="text-fg">Copy the video link</strong> — open the public Reels or video that contains the audio and copy its link.</li>
              <li><strong className="text-fg">Select Audio mode</strong> — go to the <Link href="/?tab=audio#hero" className="text-primary hover:underline">Audio tab</Link> on Downloadit.</li>
              <li><strong className="text-fg">Extract and save</strong> — paste the link, preview processing, and download the MP3.</li>
            </ol>
            <p className="text-[13.5px] leading-[1.6] text-fg-subtle">No-login audio saver: works only with audio from videos you can view publicly. Private audio always returns a clear error.</p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h3 className="text-[15px] font-bold text-fg">Supported formats</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">MP3 — Instagram audio to MP3, Instagram MP3 download for Reels sound and music.</p>
            </div>
            <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h3 className="text-[15px] font-bold text-fg">Instagram music downloader</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Save Instagram music and sound online. Works as an Instagram reel audio downloader and sound downloader.</p>
            </div>
          </div>

          <h2 className="mt-12 text-[22px] font-bold text-fg">Save Instagram audio without login</h2>
          <p className="mt-3 text-[15px] leading-[1.7] text-fg-muted">
            Users search for Instagram MP3 downloader and Instagram music downloader online to keep a reel’s sound. Downloadit lets you download Instagram audio to phone without logging in — paste a public video link in Audio mode and save the MP3 for offline listening. Whether you call it insta audio download, insta music download, or reel audio to MP3, Audio mode handles it the same way.
          </p>

          <h2 className="mt-10 text-[18px] font-bold text-fg">Privacy and limitations</h2>
          <p className="mt-2 text-[14.5px] leading-[1.7] text-fg-muted">
            Audio extraction uses server-side processing and may be temporarily unavailable. Downloadit does not store your MP3 permanently and never asks for your Instagram password. Only download audio you have the right to use.
          </p>

          <h2 className="mt-10 text-[18px] font-bold text-fg">Related downloaders</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              { href: "/instagram-reels-downloader", label: "Instagram Reels Downloader", desc: "Save Reels as MP4" },
              { href: "/instagram-video-downloader", label: "Instagram Video Downloader", desc: "Save videos as MP4" },
              { href: "/instagram-photo-downloader", label: "Instagram Photo Downloader", desc: "Save photos as JPG" },
              { href: "/instagram-story-downloader", label: "Instagram Story Downloader", desc: "Save stories before they expire" },
              { href: "/", label: "Instagram Downloader Home", desc: "All-in-one media downloader" },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="rounded-2xl p-4 hover:bg-primary-light transition-colors" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
                <span className="text-[14px] font-semibold text-primary">{l.label}</span>
                <span className="mt-1 block text-[13px] text-fg-muted">{l.desc}</span>
              </Link>
            ))}
          </div>

          <section className="mt-12">
            <h2 className="text-[20px] font-bold text-fg">Audio downloading FAQ</h2>
            <div className="mt-4 space-y-3">
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">Can I download private Instagram audio?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">No. Only audio from videos you can view publicly is supported.</p>
              </details>
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">What format is the audio?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">MP3 — Instagram reel to MP3 and Instagram audio to MP3 via server conversion.</p>
              </details>
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">Why is audio extraction temporarily unavailable?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Audio needs backend processing; if the provider is busy, try again shortly or try the video downloader for the MP4.</p>
              </details>
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">How do I get MP3 audio from a Reel?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Copy the public Reel link, open Downloadit in Audio mode, and paste it. Downloadit extracts the reel sound and returns an MP3 you can preview and save to your phone.</p>
              </details>
            </div>
          </section>

          <p className="mt-10 text-[12.5px] text-fg-subtle">
            See <Link href="/#how-it-works" className="text-primary hover:underline">How It Works</Link>, <Link href="/#faq" className="text-primary hover:underline">FAQ</Link> or <Link href="/privacy" className="text-primary hover:underline">Privacy</Link>.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}


