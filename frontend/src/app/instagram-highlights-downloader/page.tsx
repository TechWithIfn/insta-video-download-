import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/config/site";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: { absolute: "Instagram Highlights Downloader – Save Highlights | Downloadit" },
  description: "Download public Instagram Highlights and collections with Downloadit. Save highlight covers and stories from public profiles — no login required.",
  alternates: { canonical: "/instagram-highlights-downloader" },
  openGraph: {
    title: { absolute: "Instagram Highlights Downloader – Save Highlights | Downloadit" },
    description: "Download public Instagram Highlights and collections with Downloadit. Save highlight covers and stories from public profiles — no login required.",
    url: `${SITE_URL}/instagram-highlights-downloader`,
    type: "website",
    images: [{ url: "/og-downloadit.png", width: 1200, height: 630, alt: "Instagram Highlights Downloader — Downloadit" }],
  },
  twitter: {
    card: "summary_large_image",
    title: { absolute: "Instagram Highlights Downloader – Save Highlights | Downloadit" },
    description: "Download public Instagram Highlights and collections with Downloadit. Save highlight covers and stories from public profiles — no login required.",
    images: ["/og-downloadit.png"],
  },
};

export default function HighlightsDownloaderPage() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <section className="mx-auto max-w-[900px] px-5 sm:px-6 lg:px-12 pt-28 sm:pt-36 pb-12">
          <h1 className="text-[32px] font-extrabold tracking-[-0.02em] text-fg sm:text-[42px] leading-[1.1]">Instagram Highlights Downloader</h1>
          <p className="mt-4 text-[17px] leading-[1.7] text-fg-muted">
            Download public Instagram Highlights with Downloadit. Save highlight collections — the saved stories that stay on a profile — as images or videos to your device, no login required.
          </p>
          <p className="mt-3 text-[15px] leading-[1.7] text-fg-muted">
            Highlights are curated story archives on a public profile. Paste a Highlights link, preview each item, and download the original media. Works as an Instagram Highlights saver for phone and desktop, directly in your browser.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/#hero" className="inline-flex min-h-[48px] items-center justify-center rounded-2xl px-6 text-[15px] font-bold text-white shadow-[var(--shadow-brand)]" style={{ background: "var(--brand-gradient)" }}>
              Download Highlights — Paste Link
            </Link>
            <Link href="/" className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-border bg-card px-6 text-[15px] font-semibold text-fg hover:bg-primary-light">Back to Instagram Downloader</Link>
          </div>

          <div className="mt-12 grid gap-6 rounded-[24px] p-6 sm:p-8" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-card)" }}>
            <h2 className="text-[20px] font-bold text-fg">How the Instagram Highlights downloader works</h2>
            <ol className="list-decimal pl-5 space-y-2 text-[14.5px] leading-[1.7] text-fg-muted">
              <li><strong className="text-fg">Copy the Highlights link</strong> — open the profile, tap a highlight, copy its link.</li>
              <li><strong className="text-fg">Paste it in Downloadit</strong> — use the <Link href="/" className="text-primary hover:underline">Instagram Downloader</Link> homepage.</li>
              <li><strong className="text-fg">Preview and save</strong> — navigate highlight items and download each as MP4 or JPG.</li>
            </ol>
            <p className="text-[13.5px] leading-[1.6] text-fg-subtle">Only highlights from profiles you can view publicly are supported. Private highlights always return a clear error.</p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h3 className="text-[15px] font-bold text-fg">Supported formats</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">MP4 for video highlights, JPG for image highlights — same files Instagram stores.</p>
            </div>
            <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h3 className="text-[15px] font-bold text-fg">Save Highlights to phone</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Download Instagram Highlights to phone without an app. All downloads happen in the browser.</p>
            </div>
          </div>

          <h2 className="mt-12 text-[22px] font-bold text-fg">Save Instagram Highlights without login</h2>
          <p className="mt-3 text-[15px] leading-[1.7] text-fg-muted">
            Users search for Instagram Highlights downloader online and Instagram Highlights saver to keep collections that would otherwise stay only on the profile. Downloadit lets you download Instagram Highlights without login — paste a public Highlights link and save the content for offline viewing.
          </p>

          <h2 className="mt-10 text-[18px] font-bold text-fg">Privacy and limitations</h2>
          <p className="mt-2 text-[14.5px] leading-[1.7] text-fg-muted">
            Downloadit respects private settings. If a highlight is private, expired, or not publicly accessible, the backend reports the actual category instead of faking a download. Download while the temporary link is available.
          </p>

          <h2 className="mt-10 text-[18px] font-bold text-fg">Related downloaders</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              { href: "/instagram-story-downloader", label: "Instagram Story Downloader", desc: "Save stories before they expire" },
              { href: "/instagram-reels-downloader", label: "Instagram Reels Downloader", desc: "Save Reels as MP4" },
              { href: "/instagram-photo-downloader", label: "Instagram Photo Downloader", desc: "Save photos as JPG" },
              { href: "/instagram-video-downloader", label: "Instagram Video Downloader", desc: "Save videos as MP4" },
              { href: "/instagram-audio-downloader", label: "Instagram Audio Downloader", desc: "Extract MP3 from Reels" },
              { href: "/", label: "Instagram Downloader Home", desc: "All-in-one media downloader" },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="rounded-2xl p-4 hover:bg-primary-light transition-colors" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
                <span className="text-[14px] font-semibold text-primary">{l.label}</span>
                <span className="mt-1 block text-[13px] text-fg-muted">{l.desc}</span>
              </Link>
            ))}
          </div>

          <section className="mt-12">
            <h2 className="text-[20px] font-bold text-fg">Highlights downloading FAQ</h2>
            <div className="mt-4 space-y-3">
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">Can I download private Highlights?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">No. Only Highlights from profiles you can view publicly are supported.</p>
              </details>
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">How many items can I save?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Each highlight may contain multiple images/videos. Preview each and download individually.</p>
              </details>
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">Do Highlights expire?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Highlights stay until the profile owner removes them, but media CDN links are temporary — download while available.</p>
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

