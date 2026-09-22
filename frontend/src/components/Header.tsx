"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Globe, HelpCircle, Sun, Moon, Download, Menu, X, Check, Home as HomeIcon, Film, Video, Image as ImageIcon, Music2, Star, Lightbulb, CircleHelp, Shield, FileText } from "lucide-react";
import { useLanguage, LANGUAGES } from "@/i18n";
import type { DownloaderTab } from "@/components/HeroDownloader";

function getInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    const stored = localStorage.getItem("downloadit-theme") as "light" | "dark" | null;
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  // No saved preference: ALWAYS Light Mode. System/OS theme is ignored.
  return "light";
}

interface HeaderProps {
  activeDownloaderTab?: DownloaderTab;
  onDownloaderTabChange?: (tab: DownloaderTab) => void;
}

export default function Header({ activeDownloaderTab, onDownloaderTabChange }: HeaderProps) {
  const { t, lang, setLang } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [langOpen, setLangOpen] = useState(false);
  const [manuallySelectedTab, setManuallySelectedTab] = useState<DownloaderTab | null>(null);
  const mountedRef = useRef(false);
  const langRef = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];
  const onHelp = pathname === "/help";

  // Initialize theme and mounted flag
  useEffect(() => {
    // Use queueMicrotask to defer the setState to avoid synchronous effect warning
    queueMicrotask(() => {
      setTheme(getInitialTheme());
      mountedRef.current = true;
    });
  }, []);

  // Sync theme to DOM and localStorage
  useEffect(() => {
    if (!mountedRef.current) return;
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("downloadit-theme", theme); } catch {}
  }, [theme]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  // Close the language dropdown on outside click or Escape
  useEffect(() => {
    if (!langOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLangOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [langOpen]);

  const closeMobileMenu = useCallback(() => {
    setManuallySelectedTab(null);
    setMobileOpen(false);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMobileMenu();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, closeMobileMenu]);

  const handleNavClick = closeMobileMenu;
  const handleDownloaderTabClick = useCallback((tab: DownloaderTab) => {
    setManuallySelectedTab(tab);
    if (onDownloaderTabChange) {
      onDownloaderTabChange(tab);
    } else {
      router.push(`/?tab=${tab}#hero`);
    }
    closeMobileMenu();
  }, [closeMobileMenu, onDownloaderTabChange, router]);
  const toggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));
  const isDark = theme === "dark";

  const iconBtn =
    "site-icon-btn flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-xl px-2 text-[15px] font-medium text-fg-muted transition-colors hover:bg-primary-light hover:text-primary sm:h-auto sm:w-auto sm:hover:bg-transparent";

  return (
    <>
      <header
        className={`fixed top-0 z-50 w-full transition-all duration-300 ${
          scrolled
            ? "bg-bg-elevated/85 backdrop-blur-xl border-b border-border/60 shadow-[var(--shadow-xs)]"
            : "bg-transparent border-b border-transparent"
        }`}
      >
        <div className="site-header-inner mx-auto flex h-[72px] max-w-[1200px] items-center justify-between gap-2 px-4 sm:px-6 lg:px-12">
          <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2 text-fg no-underline sm:gap-2.5" aria-label={t.footer.homeLabel}>
            <span
              className="site-logo-badge flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] text-white"
              style={{ background: "var(--brand-gradient)", boxShadow: "0 4px 16px rgba(124,77,245,0.30)" }}
            >
              <Download className="h-5 w-5" strokeWidth={2.2} />
            </span>
            <span className="site-logo-text truncate text-[22px] font-bold tracking-[-0.01em]">
              Download<span className="text-primary">it</span>
            </span>
          </Link>

          <div className="site-controls flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-6">
            <div className="relative" ref={langRef}>
              <button
                type="button"
                onClick={() => setLangOpen((o) => !o)}
                className={iconBtn}
                aria-label={t.common.language}
                aria-haspopup="menu"
                aria-expanded={langOpen}
              >
                <Globe className="h-5 w-5 shrink-0" strokeWidth={1.8} />
                <span className="hidden sm:inline">{current.short}</span>
              </button>

              {langOpen && (
                <div
                  role="menu"
                  aria-label={t.common.language}
                  className="absolute right-0 top-full z-50 mt-2 max-h-[60vh] w-[min(16rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl p-1.5 animate-fade-in"
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    boxShadow: "var(--shadow-card-hover)",
                  }}
                >
                  <p className="flex items-center gap-2 px-3 pb-1 pt-2 text-[12px] font-bold uppercase tracking-[0.1em] text-fg-subtle">
                    <Globe className="h-3.5 w-3.5" strokeWidth={2} />
                    {t.common.language}
                  </p>
                  {LANGUAGES.map((l) => {
                    const active = l.code === lang;
                    return (
                      <button
                        key={l.code}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => {
                          setLang(l.code);
                          setLangOpen(false);
                        }}
                        className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 text-left text-[14.5px] transition-colors hover:bg-primary-light"
                        style={{
                          background: active ? "var(--primary-light)" : "transparent",
                          color: active ? "var(--primary)" : "var(--fg)",
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {active ? (
                          <Check className="h-[18px] w-[18px] shrink-0" strokeWidth={2.5} />
                        ) : (
                          <span className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                        )}
                        <span className="flex-1">{l.label}</span>
                        <span className="text-[12px] font-semibold text-fg-subtle">{l.short}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <Link
              href="/help"
              className={iconBtn}
              aria-label={t.common.help}
              aria-current={onHelp ? "page" : undefined}
              style={onHelp ? { color: "var(--primary)" } : undefined}
            >
              <HelpCircle className="h-5 w-5 shrink-0" strokeWidth={1.8} />
              <span className="hidden sm:inline" style={onHelp ? { fontWeight: 700 } : undefined}>
                {t.common.help}
              </span>
            </Link>

            <button
              type="button"
              onClick={toggleTheme}
              className="theme-toggle"
              aria-label={isDark ? t.header.themeToLight : t.header.themeToDark}
            >
              <div className="theme-toggle__thumb">
                {isDark ? <Moon className="h-3.5 w-3.5 text-white" strokeWidth={2.2} /> : <Sun className="h-3.5 w-3.5 text-white" strokeWidth={2.2} />}
              </div>
              {isDark ? (
                <Moon className="absolute right-3 h-3.5 w-3.5" style={{ color: "var(--fg-subtle)" }} strokeWidth={1.8} />
              ) : (
                <Sun className="absolute right-3 h-3.5 w-3.5" style={{ color: "var(--fg-subtle)" }} strokeWidth={1.8} />
              )}
            </button>

            <button
              type="button"
              className="site-menu-btn flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-primary-light hover:text-primary lg:hidden"
              onClick={() => {
                setManuallySelectedTab(null);
                setMobileOpen(true);
              }}
              aria-label={t.header.openMenu}
              aria-expanded={mobileOpen}
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm animate-fade-in lg:hidden" onClick={handleNavClick} aria-hidden="true" />
      )}

      <div
        className={`mobile-drawer fixed inset-y-0 right-0 z-50 flex h-full w-[min(82vw,380px)] flex-col overflow-hidden rounded-l-[28px] bg-bg-elevated shadow-[var(--shadow-xl)] transition-transform duration-300 ease-out lg:hidden ${mobileOpen ? "translate-x-0 pointer-events-auto" : "translate-x-full pointer-events-none"}`}
        role="dialog" aria-modal="true" aria-hidden={!mobileOpen} aria-label={t.common.mobileNav}
      >
        <div className="mobile-drawer-header flex h-[68px] shrink-0 items-center justify-between border-b border-border px-5">
          <div>
            <span className="block text-[16px] font-bold text-fg">Downloadit</span>
            <span className="block text-[11px] font-medium text-fg-subtle">{t.common.mobileNav}</span>
          </div>
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-primary-light hover:text-primary" onClick={closeMobileMenu} aria-label={t.header.closeMenu}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="mobile-drawer-nav flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain p-4" aria-label={t.common.mobileNav}>
          <Link href="/#hero" onClick={handleNavClick} className={`flex min-h-[44px] items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-semibold transition-colors hover:bg-primary-light hover:text-primary ${pathname === "/" && !activeDownloaderTab ? "bg-primary-light text-primary" : "text-fg"}`}>
            <span className="mobile-nav-icon bg-primary-light text-primary"><HomeIcon className="h-[18px] w-[18px]" /></span>
            <span>Home</span>
          </Link>
          {([
            ["reels", "Download Reels", Film, "text-pink-500", "bg-pink-500/10"],
            ["videos", "Download Video", Video, "text-primary", "bg-primary-light"],
            ["photos", "Download Photos", ImageIcon, "text-orange-500", "bg-orange-500/10"],
            ["audio", "Download Audio", Music2, "text-emerald-500", "bg-emerald-500/10"],
            ["highlights", "Download Highlights", Star, "text-amber-500", "bg-amber-500/10"],
          ] as const).map(([tab, label, Icon]) => {
            const active = manuallySelectedTab === tab && activeDownloaderTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => handleDownloaderTabClick(tab)}
                className={`flex min-h-[44px] w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[15px] font-semibold transition-colors hover:bg-primary-light hover:text-primary ${active ? "bg-primary-light text-primary" : "text-fg"}`}
                aria-current={active ? "true" : undefined}
              >
                <span className={`mobile-nav-icon ${["bg-pink-500/10", "bg-primary-light", "bg-orange-500/10", "bg-emerald-500/10", "bg-amber-500/10"][(["reels", "videos", "photos", "audio", "highlights"] as const).indexOf(tab)]}`}><Icon className="h-[18px] w-[18px]" /></span>
                <span>{label}</span>
              </button>
            );
          })}
          <div className="my-2 border-t border-border-light" />
          <Link href="/#how-it-works" onClick={handleNavClick} className="flex min-h-[44px] items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-semibold text-fg transition-colors hover:bg-primary-light hover:text-primary">
            <span className="mobile-nav-icon bg-violet-500/10 text-violet-500"><Lightbulb className="h-[18px] w-[18px]" /></span>
            <span>How It Works</span>
          </Link>
          <Link href="/help" onClick={handleNavClick} className="flex min-h-[44px] items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-semibold text-fg transition-colors hover:bg-primary-light hover:text-primary">
            <span className="mobile-nav-icon bg-sky-500/10 text-sky-500"><CircleHelp className="h-[18px] w-[18px]" /></span>
            <span>Help</span>
          </Link>
          <Link href="/privacy" onClick={handleNavClick} className="flex min-h-[44px] items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-semibold text-fg transition-colors hover:bg-primary-light hover:text-primary">
            <span className="mobile-nav-icon bg-teal-500/10 text-teal-500"><Shield className="h-[18px] w-[18px]" /></span>
            <span>Privacy</span>
          </Link>
          <Link href="/terms" onClick={handleNavClick} className="flex min-h-[44px] items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-semibold text-fg transition-colors hover:bg-primary-light hover:text-primary">
            <span className="mobile-nav-icon bg-slate-500/10 text-slate-500"><FileText className="h-[18px] w-[18px]" /></span>
            <span>Terms</span>
          </Link>
        </nav>
        <div className="mobile-drawer-cta shrink-0 border-t border-border p-4 pb-[calc(1rem+var(--sab))]">
          <Link href="/#hero" onClick={handleNavClick} className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[15px] font-bold text-white shadow-[var(--shadow-brand)] transition-transform active:scale-[0.98]" style={{ background: "var(--brand-gradient)" }}>
            <Download className="h-4 w-4" />
            <span>{t.common.startDownloading}</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </>
  );
}
