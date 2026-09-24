import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/config/site";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: { absolute: "Instagram Video Downloader – Save Videos as MP4 | Downloadit" },
  description: "Download public Instagram videos and Reels as MP4 with Downloadit. Paste a link, preview the video and save it in HD — no login required.",
  alternates: { canonical: "/instagram-video-downloader" },
  openGraph: {
    title: { absolute: "Instagram Video Downloader – Save Videos as MP4 | Downloadit" },
    description: "Download public Instagram videos and Reels as MP4 with Downloadit. Paste a link, preview the video and save it in HD — no login required.",
    url: `${SITE_URL}/instagram-video-downloader`,
    type: "website",
    images: [{ url: "/og-downloadit.png", width: 1200, height: 630, alt: "Instagram Video Downloader — Downloadit" }],
  },
  twitter: {
    card: "summary_large_image",
    title: { absolute: "Instagram Video Downloader – Save Videos as MP4 | Downloadit" },
    description: "Download public Instagram videos and Reels as MP4 with Downloadit. Paste a link, preview the video and save it in HD — no login required.",
    images: ["/og-downloadit.png"],
  },
};

export default function VideoDownloaderPage() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <section className="mx-auto max-w-[900px] px-5 sm:px-6 lg:px-12 pt-28 sm:pt-36 pb-12">
          <h1 className="text-[32px] font-extrabold tracking-[-0.02em] text-fg sm:text-[42px] leading-[1.1]">Instagram Video Downloader</h1>
          <p className="mt-4 text-[17px] leading-[1.7] text-fg-muted">
            Download public Instagram videos as MP4 with Downloadit. Whether it’s a standard feed video, IGTV-style clip, or long-form post, paste the video link, preview the file and save it to your device — no login required.
          </p>
          <p className="mt-3 text-[15px] leading-[1.7] text-fg-muted">
            This video downloader extracts the original MP4 served by Instagram. You get the same file for offline viewing on your phone, without installing an app or creating an account. It’s the fastest way to save Instagram videos online.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/#hero" className="inline-flex min-h-[48px] items-center justify-center rounded-2xl px-6 text-[15px] font-bold text-white shadow-[var(--shadow-brand)]" style={{ background: "var(--brand-gradient)" }}>
              Download a Video — Paste Link
            </Link>
            <Link href="/" className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-border bg-card px-6 text-[15px] font-semibold text-fg hover:bg-primary-light">Back to Instagram Downloader</Link>
          </div>

          <div className="mt-12 grid gap-6 rounded-[24px] p-6 sm:p-8" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-card)" }}>
            <h2 className="text-[20px] font-bold text-fg">How the Instagram video downloader works</h2>
            <ol className="list-decimal pl-5 space-y-2 text-[14.5px] leading-[1.7] text-fg-muted">
              <li><strong className="text-fg">Copy the video link</strong> — open the Instagram video and copy its share link.</li>
              <li><strong className="text-fg">Paste it in Downloadit</strong> — use the <Link href="/" className="text-primary hover:underline">Instagram Downloader</Link> homepage.</li>
              <li><strong className="text-fg">Preview and save</strong> — confirm the preview, then download the MP4 in HD.</li>
            </ol>
            <p className="text-[13.5px] leading-[1.6] text-fg-subtle">No-login workflow: only videos you can view publicly in a browser without signing in are eligible. Private videos always return a clear error.</p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h3 className="text-[15px] font-bold text-fg">Supported format</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">MP4 — Instagram video to MP4 converter, keep original quality for phone or desktop.</p>
            </div>
            <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h3 className="text-[15px] font-bold text-fg">Download to phone</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Works on mobile, tablet and desktop. Save Instagram videos to phone directly in the browser.</p>
            </div>
          </div>

          <h2 className="mt-12 text-[22px] font-bold text-fg">Save Instagram videos without login</h2>
          <p className="mt-3 text-[15px] leading-[1.7] text-fg-muted">
            Many users search for “download Instagram video without login”. Downloadit solves that: paste a public video URL and get an MP4 without providing your Instagram password. The file is the same HD stream Instagram uses, so you can save Instagram videos and watch them offline.
          </p>

          <h2 className="mt-10 text-[18px] font-bold text-fg">Privacy and limitations</h2>
          <p className="mt-2 text-[14.5px] leading-[1.7] text-fg-muted">
            Downloadit processes links temporarily and does not store your videos permanently. If a video is private, deleted, or restricted, the backend explains the actual category (private/expired/blocked) instead of faking a download. Only download content you have the right to save.
          </p>

          <h2 className="mt-10 text-[18px] font-bold text-fg">Related downloaders</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              { href: "/instagram-reels-downloader", label: "Instagram Reels Downloader", desc: "Save Reels as MP4" },
              { href: "/instagram-photo-downloader", label: "Instagram Photo Downloader", desc: "Save photos as JPG" },
              { href: "/instagram-story-downloader", label: "Instagram Story Downloader", desc: "Save stories before they expire" },
              { href: "/instagram-highlights-downloader", label: "Instagram Highlights Downloader", desc: "Save highlight collections" },
              { href: "/instagram-audio-downloader", label: "Instagram Audio Downloader", desc: "Extract MP3 from videos" },
              { href: "/", label: "Instagram Downloader Home", desc: "All-in-one media downloader" },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="rounded-2xl p-4 hover:bg-primary-light transition-colors" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
                <span className="text-[14px] font-semibold text-primary">{l.label}</span>
                <span className="mt-1 block text-[13px] text-fg-muted">{l.desc}</span>
              </Link>
            ))}
          </div>

          <section className="mt-12">
            <h2 className="text-[20px] font-bold text-fg">Video downloading FAQ</h2>
            <div className="mt-4 space-y-3">
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">Do I need an account to download Instagram videos?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">No. Downloadit is an Instagram downloader no login tool. Use public links only.</p>
              </details>
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">Can I download a private video?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">No. Private or Close Friends videos are never supported and return a clear error.</p>
              </details>
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">Why did the MP4 link expire?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Instagram signs media URLs temporarily. Resolve the original post link again for a fresh download URL.</p>
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

