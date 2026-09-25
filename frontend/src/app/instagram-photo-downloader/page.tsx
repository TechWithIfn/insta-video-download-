import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/config/site";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: { absolute: "Instagram Photo Downloader – Save Photos & Images | Downloadit" },
  description: "Download public Instagram photos and images in original quality with Downloadit. Save single photos or carousel slides quickly — no login required.",
  alternates: { canonical: "/instagram-photo-downloader" },
  openGraph: {
    title: { absolute: "Instagram Photo Downloader – Save Photos & Images | Downloadit" },
    description: "Download public Instagram photos and images in original quality with Downloadit. Save single photos or carousel slides quickly — no login required.",
    url: `${SITE_URL}/instagram-photo-downloader`,
    type: "website",
    images: [{ url: "/og-downloadit.png", width: 1200, height: 630, alt: "Instagram Photo Downloader — Downloadit" }],
  },
  twitter: {
    card: "summary_large_image",
    title: { absolute: "Instagram Photo Downloader – Save Photos & Images | Downloadit" },
    description: "Download public Instagram photos and images in original quality with Downloadit. Save single photos or carousel slides quickly — no login required.",
    images: ["/og-downloadit.png"],
  },
};

export default function PhotoDownloaderPage() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <section className="mx-auto max-w-[900px] px-5 sm:px-6 lg:px-12 pt-8 sm:pt-12 pb-12">
          <h1 className="text-[32px] font-extrabold tracking-[-0.02em] text-fg sm:text-[42px] leading-[1.1]">Instagram Photo Downloader</h1>
          <p className="mt-4 text-[17px] leading-[1.7] text-fg-muted">
            Download public Instagram photos and images in original quality with Downloadit. Save single image posts or every slide of a carousel to your phone — no login required.
          </p>
          <p className="mt-3 text-[15px] leading-[1.7] text-fg-muted">
            This photo saver preserves the JPG or PNG file Instagram serves for display. Paste a post link, preview each slide with its real resolution, and download the original image — not a compressed screenshot.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/#hero" className="inline-flex min-h-[48px] items-center justify-center rounded-2xl px-6 text-[15px] font-bold text-white shadow-[var(--shadow-brand)]" style={{ background: "var(--brand-gradient)" }}>
              Download a Photo — Paste Link
            </Link>
            <Link href="/" className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-border bg-card px-6 text-[15px] font-semibold text-fg hover:bg-primary-light">Back to Instagram Downloader</Link>
          </div>

          <div className="mt-12 grid gap-6 rounded-[24px] p-6 sm:p-8" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-card)" }}>
            <h2 className="text-[20px] font-bold text-fg">How the Instagram photo downloader works</h2>
            <ol className="list-decimal pl-5 space-y-2 text-[14.5px] leading-[1.7] text-fg-muted">
              <li><strong className="text-fg">Copy the post link</strong> — open the Instagram photo or carousel and copy its link.</li>
              <li><strong className="text-fg">Paste it in Downloadit</strong> — use the <Link href="/" className="text-primary hover:underline">Instagram Downloader</Link> homepage.</li>
              <li><strong className="text-fg">Choose the image</strong> — preview each carousel slide and download the JPG in original quality.</li>
            </ol>
            <p className="text-[13.5px] leading-[1.6] text-fg-subtle">No-login image saver: works only with photos you can view publicly. Private images return a clear error and are never bypassed.</p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h3 className="text-[15px] font-bold text-fg">Supported formats</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">JPG, PNG, WebP — original image saver output, not recompressed.</p>
            </div>
            <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h3 className="text-[15px] font-bold text-fg">Carousel support</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Carousels show a counter (1/7). Navigate with Next/Previous — current image stays until next is ready, no flash.</p>
            </div>
          </div>

          <h2 className="mt-12 text-[22px] font-bold text-fg">Save Instagram photos without login</h2>
          <p className="mt-3 text-[15px] leading-[1.7] text-fg-muted">
            People search for Instagram photo downloader online and Instagram image saver to keep high-resolution photos for offline viewing. Downloadit lets you download Instagram photos to phone directly in the browser — paste a public photo link and save the original image without creating an Instagram account. The same page answers insta photo download and insta image download searches for both single photos and multi-photo posts.
          </p>

          <h2 className="mt-10 text-[18px] font-bold text-fg">Limitations for private content</h2>
          <p className="mt-2 text-[14.5px] leading-[1.7] text-fg-muted">
            Only publicly accessible photos are supported. If an image is private, deleted, or restricted, the backend explains the category instead of faking a download.
          </p>

          <h2 className="mt-10 text-[18px] font-bold text-fg">Related downloaders</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              { href: "/instagram-reels-downloader", label: "Instagram Reels Downloader", desc: "Save Reels as MP4" },
              { href: "/instagram-video-downloader", label: "Instagram Video Downloader", desc: "Save videos as MP4" },
              { href: "/instagram-story-downloader", label: "Instagram Story Downloader", desc: "Save stories before they expire" },
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
            <h2 className="text-[20px] font-bold text-fg">Photo downloading FAQ</h2>
            <div className="mt-4 space-y-3">
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">Can I download carousel photos?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Yes. Paste a carousel link, navigate slides with Next/Previous, and download each JPG individually.</p>
              </details>
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">What quality are the photos?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Original quality as served by Instagram (JPG/WebP), not a compressed preview.</p>
              </details>
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">Do I need to log in?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">No. Downloadit is an Instagram downloader no login image saver for public links.</p>
              </details>
              <details className="group rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <summary className="cursor-pointer text-[15px] font-semibold text-fg">How do I save Instagram photos to my phone?</summary>
                <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">Copy the photo post link, paste it into Downloadit, and download each image in original quality. On mobile the JPG saves straight to your device from the browser.</p>
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


