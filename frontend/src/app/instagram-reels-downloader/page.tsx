import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/config/site";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: { absolute: "Instagram Reels Downloader – Save Reels as MP4 | Downloadit" },
  description: "Download public Instagram Reels as MP4 with Downloadit. Preview trending reels and save them to your phone quickly — no login required.",
  alternates: { canonical: "/instagram-reels-downloader" },
  openGraph: {
    title: { absolute: "Instagram Reels Downloader – Save Reels as MP4 | Downloadit" },
    description: "Download public Instagram Reels as MP4 with Downloadit. Preview trending reels and save them to your phone quickly — no login required.",
    url: `${SITE_URL}/instagram-reels-downloader`,
    type: "website",
    images: [{ url: "/og-downloadit.png", width: 1200, height: 630, alt: "Instagram Reels Downloader — Downloadit" }],
  },
  twitter: {
    card: "summary_large_image",
    title: { absolute: "Instagram Reels Downloader – Save Reels as MP4 | Downloadit" },
    description: "Download public Instagram Reels as MP4 with Downloadit. Preview trending reels and save them to your phone quickly — no login required.",
    images: ["/og-downloadit.png"],
  },
};

export default function ReelsDownloaderPage() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <section className="mx-auto max-w-[900px] px-5 sm:px-6 lg:px-12 pt-8 sm:pt-12 pb-12">
          <h1 className="text-[32px] font-extrabold tracking-[-0.02em] text-fg sm:text-[42px] leading-[1.1]">
            Instagram Reels Downloader
          </h1>
          <p className="mt-4 text-[18px] leading-[1.7] text-fg-muted">
            Save public Instagram Reels as MP4 with Downloadit. Paste a Reels link, preview the video in full quality, and download it to your phone or desktop — no login, no app install, and no account required.
          </p>
          <p className="mt-3 text-[16px] leading-[1.7] text-fg-muted">
            This Reels saver works with short-form vertical videos shared publicly on Instagram. We detect the Reels link, fetch the available MP4 source, and let you save the original reel without compression or watermarks, directly in your browser.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/#hero" className="inline-flex min-h-[48px] items-center justify-center rounded-2xl px-6 text-[16px] font-bold text-white shadow-[var(--shadow-brand)]" style={{ background: "var(--brand-gradient)" }}>
              Download a Reel — Paste Link
            </Link>
            <Link href="/" className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-border bg-card px-6 text-[16px] font-semibold text-fg hover:bg-primary-light">
              Back to Instagram Downloader
            </Link>
          </div>

          <div className="mt-12 grid gap-6 rounded-[24px] p-6 sm:p-8" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-card)" }}>
            <h2 className="text-[20px] font-bold text-fg">How the Instagram Reels downloader works</h2>
            <ol className="list-decimal pl-5 space-y-2 text-[14px] leading-[1.7] text-fg-muted">
              <li><strong className="text-fg">Copy the Reels link</strong> — open Instagram, tap Share on the reel and copy its link.</li>
              <li><strong className="text-fg">Paste it in Downloadit</strong> — go to the <Link href="/" className="text-primary hover:underline">Instagram Downloader</Link> and paste the URL.</li>
              <li><strong className="text-fg">Preview and save</strong> — preview the reel as MP4 and tap Download to save it to your device.</li>
            </ol>
            <p className="text-[14px] leading-[1.6] text-fg-subtle">
              No login workflow: Downloadit works only with publicly accessible reels. Private or restricted reels cannot be fetched, and we never ask for your Instagram password or session cookie.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h3 className="text-[16px] font-bold text-fg">Supported format</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">MP4 video — same file Instagram serves for playback. Keep HD quality for phone or desktop.</p>
            </div>
            <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h3 className="text-[16px] font-bold text-fg">Privacy</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Links are resolved temporarily and not stored permanently. Download while the temporary link is available.</p>
            </div>
          </div>

          <h2 className="mt-12 text-[24px] font-bold text-fg">Why save Instagram Reels to your phone</h2>
          <p className="mt-3 text-[16px] leading-[1.7] text-fg-muted">
            Reels are short vertical videos that disappear in your feed. Saving a public reel lets you watch it offline, share it in presentations, or keep inspiration for later. Whether you searched for an insta reels downloader, an insta reel download for your phone, or a reel saver, the flow is the same — paste a public link and get an MP4 without creating an Instagram account.
          </p>

          <h2 className="mt-10 text-[18px] font-bold text-fg">Limitations for private content</h2>
          <p className="mt-2 text-[14px] leading-[1.7] text-fg-muted">
            Downloadit respects Instagram’s privacy settings. If a reel is private, Close Friends, or removed, the backend returns a clear “private/restricted” message and does not attempt to bypass it. Only reels you can view publicly in a browser without logging in are eligible.
          </p>

          <h2 className="mt-10 text-[18px] font-bold text-fg">Related downloaders</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              { href: "/instagram-video-downloader", label: "Instagram Video Downloader", desc: "Save standard video posts as MP4" },
              { href: "/instagram-photo-downloader", label: "Instagram Photo Downloader", desc: "Save photos and carousel slides as JPG" },
              { href: "/instagram-story-downloader", label: "Instagram Story Downloader", desc: "Save stories before they expire" },
              { href: "/instagram-audio-downloader", label: "Instagram Audio Downloader", desc: "Extract MP3 audio from Reels" },
              { href: "/", label: "Instagram Downloader Home", desc: "All-in-one media downloader" },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="rounded-2xl p-4 hover:bg-primary-light transition-colors" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
                <span className="text-[14px] font-semibold text-primary">{l.label}</span>
                <span className="mt-1 block text-[14px] text-fg-muted">{l.desc}</span>
              </Link>
            ))}
          </div>

          <section className="mt-12">
            <h2 className="text-[20px] font-bold text-fg">Reels downloading FAQ</h2>
            <div className="mt-4 space-y-3">
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[16px] font-semibold text-fg">Can I download a private Instagram Reel?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">No. Downloadit only works with reels you can view publicly. Private reels always show a clear error and are never bypassed.</p>
              </details>
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[16px] font-semibold text-fg">What format is a downloaded reel?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">MP4 — the same HD file Instagram streams. Use it as Instagram reel to MP4 on phone or desktop.</p>
              </details>
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[16px] font-semibold text-fg">Do I need to log in to download reels?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">No. Paste the public Reels link and download without login. No account or password is ever requested.</p>
              </details>
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[16px] font-semibold text-fg">How do I save Instagram Reels to my phone?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Copy the reel link in the Instagram app, paste it into Downloadit on this page, preview the MP4, and tap Download. The file saves to your phone gallery or downloads folder.</p>
              </details>
            </div>
          </section>

          <p className="mt-10 text-[12px] text-fg-subtle">
            Learn how the downloader works on the <Link href="/#how-it-works" className="text-primary hover:underline">How It Works</Link> section, find answers in the <Link href="/#faq" className="text-primary hover:underline">FAQ</Link>, or read our <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}


