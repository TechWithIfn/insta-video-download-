import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/config/site";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: { absolute: "Instagram Story Downloader – Save Stories | Downloadit" },
  description: "Download public Instagram Stories before they disappear with Downloadit. Save story images and videos from public accounts quickly — no login required.",
  alternates: { canonical: "/instagram-story-downloader" },
  openGraph: {
    title: { absolute: "Instagram Story Downloader – Save Stories | Downloadit" },
    description: "Download public Instagram Stories before they disappear with Downloadit. Save story images and videos from public accounts quickly — no login required.",
    url: `${SITE_URL}/instagram-story-downloader`,
    type: "website",
    images: [{ url: "/og-downloadit.png", width: 1200, height: 630, alt: "Instagram Story Downloader — Downloadit" }],
  },
  twitter: {
    card: "summary_large_image",
    title: { absolute: "Instagram Story Downloader – Save Stories | Downloadit" },
    description: "Download public Instagram Stories before they disappear with Downloadit. Save story images and videos from public accounts quickly — no login required.",
    images: ["/og-downloadit.png"],
  },
};

export default function StoryDownloaderPage() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <section className="mx-auto max-w-[900px] px-5 sm:px-6 lg:px-12 pt-8 sm:pt-12 pb-12">
          <h1 className="text-[32px] font-extrabold tracking-[-0.02em] text-fg sm:text-[42px] leading-[1.1]">Instagram Story Downloader</h1>
          <p className="mt-4 text-[17px] leading-[1.7] text-fg-muted">
            Download public Instagram Stories before they disappear with Downloadit. Save story images and videos from public accounts to your phone — no login required.
          </p>
          <p className="mt-3 text-[15px] leading-[1.7] text-fg-muted">
            Stories are vertical photos and clips that expire after 24 hours. Our Instagram story saver detects a public story link, previews the current media, and lets you download the original image or MP4 without creating an Instagram account.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/#hero" className="inline-flex min-h-[48px] items-center justify-center rounded-2xl px-6 text-[15px] font-bold text-white shadow-[var(--shadow-brand)]" style={{ background: "var(--brand-gradient)" }}>
              Download a Story — Paste Link
            </Link>
            <Link href="/" className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-border bg-card px-6 text-[15px] font-semibold text-fg hover:bg-primary-light">Back to Instagram Downloader</Link>
          </div>

          <div className="mt-12 grid gap-6 rounded-[24px] p-6 sm:p-8" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-card)" }}>
            <h2 className="text-[20px] font-bold text-fg">How the Instagram story downloader works</h2>
            <ol className="list-decimal pl-5 space-y-2 text-[14.5px] leading-[1.7] text-fg-muted">
              <li><strong className="text-fg">Copy the story link</strong> — open the public story and copy its link.</li>
              <li><strong className="text-fg">Paste it in Downloadit</strong> — use the <Link href="/" className="text-primary hover:underline">Instagram Downloader</Link> homepage.</li>
              <li><strong className="text-fg">Preview and save</strong> — view the story image or video and download it in original quality.</li>
            </ol>
            <p className="text-[13.5px] leading-[1.6] text-fg-subtle">No-login story saver: only stories you can view publicly without signing in are eligible. Expired stories always show a clear “expired/not found” message.</p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h3 className="text-[15px] font-bold text-fg">Supported formats</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">MP4 for video stories, JPG for image stories — same files Instagram uses for playback.</p>
            </div>
            <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h3 className="text-[15px] font-bold text-fg">Download to phone</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Save Instagram stories to phone directly in the browser. No app install needed.</p>
            </div>
          </div>

          <h2 className="mt-12 text-[22px] font-bold text-fg">Save Instagram stories without login</h2>
          <p className="mt-3 text-[15px] leading-[1.7] text-fg-muted">
            Many users search for Instagram story downloader online and Instagram story saver to keep public stories before they vanish. Downloadit is an Instagram story download tool that works as a story saver for phone and desktop — paste a public story link and save the media for offline viewing.
          </p>

          <h2 className="mt-10 text-[18px] font-bold text-fg">Limitations for private and expired content</h2>
          <p className="mt-2 text-[14.5px] leading-[1.7] text-fg-muted">
            Stories expire after 24 hours. If a story is private, Close Friends, deleted, or expired, the backend reports the actual category instead of faking a download. Download while the temporary media link is available.
          </p>

          <h2 className="mt-10 text-[18px] font-bold text-fg">Related downloaders</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              { href: "/instagram-reels-downloader", label: "Instagram Reels Downloader", desc: "Save Reels as MP4" },
              { href: "/instagram-photo-downloader", label: "Instagram Photo Downloader", desc: "Save photos as JPG" },
              { href: "/instagram-video-downloader", label: "Instagram Video Downloader", desc: "Save videos as MP4" },
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
            <h2 className="text-[20px] font-bold text-fg">Story downloading FAQ</h2>
            <div className="mt-4 space-y-3">
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">Can I download a private Instagram story?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">No. Only stories from profiles you can view publicly are supported.</p>
              </details>
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">Why does a story show as expired?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Stories auto-expire after 24 hours on Instagram. Once expired, the story link no longer resolves to media.</p>
              </details>
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">Do I need to log in?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">No. Downloadit is an Instagram downloader no login story saver for public links.</p>
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


