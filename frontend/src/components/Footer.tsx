"use client";

import { useEffect, useState } from "react";
import { Download, Mail } from "lucide-react";
import Link from "next/link";
import { SUPPORT_EMAIL, SUPPORT_GMAIL_URL } from "@/config/site";
import { useLanguage } from "@/i18n";

function LinkColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <nav aria-label={title}>
      <h3 className="text-[13px] font-bold uppercase tracking-[0.1em] text-fg">{title}</h3>
      <ul className="mt-4 flex flex-col gap-1">
        {links.map((link) => {
          const isPage = link.href.startsWith("/");
          const className =
            "flex min-h-[44px] items-center text-[14.5px] text-fg-muted transition-colors hover:text-primary sm:min-h-[36px]";
          return (
            <li key={link.label}>
              {isPage ? (
                <Link href={link.href} className={className}>
                  {link.label}
                </Link>
              ) : (
                <a href={link.href} className={className}>
                  {link.label}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function Footer() {
  const { t } = useLanguage();
  // Resolved after mount so the statically prerendered HTML (baked at build
  // time) and the first client render are byte-identical — computing the
  // year during render would hydrate-mismatch whenever build year and view
  // year differ.
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => {
    // Deferred (repo convention) to avoid a synchronous setState in effect.
    queueMicrotask(() => {
      setYear(new Date().getFullYear());
    });
  }, []);

  const PRODUCT_LINKS = [
    { label: "Instagram Reels Downloader", href: "/instagram-reels-downloader" },
    { label: "Instagram Video Downloader", href: "/instagram-video-downloader" },
    { label: "Instagram Photo Downloader", href: "/instagram-photo-downloader" },
    { label: "Instagram Story Downloader", href: "/instagram-story-downloader" },
    { label: "Instagram Audio Downloader", href: "/instagram-audio-downloader" },
  ];

  const RESOURCE_LINKS = [
    { label: t.nav.howItWorks, href: "/#how-it-works" },
    { label: t.nav.features, href: "/#features" },
    { label: t.nav.faq, href: "/#faq" },
    { label: t.common.help, href: "/help" },
  ];

  const LEGAL_LINKS = [
    { label: t.footer.legalLinks.privacy, href: "/privacy" },
    { label: t.footer.legalLinks.terms, href: "/terms" },
    { label: t.footer.legalLinks.dmca, href: "/dmca" },
    { label: t.footer.legalLinks.disclaimer, href: "/disclaimer" },
  ];

  return (
    <footer className="mt-20 border-t border-border px-4 py-12 sm:px-6 lg:px-8 xl:px-12">
      <div className="mx-auto max-w-[1200px]">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          {/* Brand */}
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5" aria-label={t.footer.homeLabel}>
              <span
                className="flex h-9 w-9 items-center justify-center rounded-[10px] text-white"
                style={{ background: "var(--brand-gradient)" }}
              >
                <Download className="h-[18px] w-[18px]" strokeWidth={2.2} />
              </span>
              <span className="text-[18px] font-bold text-fg">
                Download<span className="text-primary">it</span>
              </span>
            </Link>
            <p className="mt-4 text-[14.5px] font-semibold text-fg">
              {t.footer.tagline}
            </p>
            <p className="mt-2 max-w-[300px] text-[13.5px] leading-[1.65] text-fg-muted">
              {t.footer.desc}
            </p>
            <div className="mt-5">
              <p className="text-[13px] font-bold uppercase tracking-[0.1em] text-fg">{t.footer.email}</p>
              <a
                href={SUPPORT_GMAIL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex min-h-[44px] items-center gap-2 break-all text-[14.5px] font-medium text-fg-muted transition-colors hover:text-primary"
              >
                <Mail className="h-4 w-4 shrink-0" strokeWidth={2} />
                {SUPPORT_EMAIL}
              </a>
            </div>
          </div>

          <LinkColumn title={t.footer.product} links={PRODUCT_LINKS} />
          <LinkColumn title={t.footer.resources} links={RESOURCE_LINKS} />
          <LinkColumn title={t.footer.legal} links={LEGAL_LINKS} />
        </div>

        <p className="mt-10 text-[12.5px] text-fg-subtle">
          {t.footer.disclaimer}
        </p>

        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-fg-muted">&copy;{year !== null ? ` ${year}` : ""} Downloadit. {t.footer.rights}</p>
          <p className="text-[13px] text-fg-subtle">{t.footer.madeWith}</p>
        </div>
      </div>
    </footer>
  );
}
