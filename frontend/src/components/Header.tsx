"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe, HelpCircle, Sun, Moon, Download, Menu, X, ArrowRight, Check } from "lucide-react";
import { useLanguage, LANGUAGES } from "@/i18n";

function getInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    const stored = localStorage.getItem("snapsave-theme") as "light" | "dark" | null;
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function Header() {
  const { t, lang, setLang } = useLanguage();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [langOpen, setLangOpen] = useState(false);
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
    try { localStorage.setItem("snapsave-theme", theme); } catch {}
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

  const handleNavClick = useCallback(() => setMobileOpen(false), []);
  const toggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));
  const isDark = theme === "dark";

  const iconBtn =
    "flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-xl px-2 text-[15px] font-medium text-fg-muted transition-colors hover:bg-primary-light hover:text-primary sm:h-auto sm:w-auto sm:hover:bg-transparent";

  return (
    <>
      <header
        className={`fixed top-0 z-50 w-full transition-all duration-300 ${
          scrolled
            ? "bg-bg-elevated/85 backdrop-blur-xl border-b border-border/60 shadow-[var(--shadow-xs)]"
            : "bg-transparent border-b border-transparent"
        }`}
      >
        <div className="mx-auto flex h-[72px] max-w-[1200px] items-center justify-between px-4 sm:px-6 lg:px-12">
          <Link href="/" className="flex items-center gap-2.5 text-fg no-underline" aria-label={t.footer.homeLabel}>
            <span
              className="flex h-[42px] w-[42px] items-center justify-center rounded-[12px] text-white"
              style={{ background: "var(--brand-gradient)", boxShadow: "0 4px 16px rgba(124,77,245,0.30)" }}
            >
              <Download className="h-5 w-5" strokeWidth={2.2} />
            </span>
            <span className="text-[22px] font-bold tracking-[-0.01em]">
              Snap<span className="text-primary">Save</span>
            </span>
          </Link>

          <div className="flex items-center gap-1 sm:gap-6">
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
                  className="absolute right-0 top-full z-50 mt-2 max-h-[60vh] w-64 overflow-y-auto rounded-2xl p-1.5 animate-fade-in"
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
              className="flex h-10 w-10 items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-primary-light hover:text-primary lg:hidden"
              onClick={() => setMobileOpen(true)}
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
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-[380px] bg-bg-elevated shadow-[var(--shadow-xl)] transition-transform duration-300 ease-out lg:hidden ${mobileOpen ? "translate-x-0" : "translate-x-full"}`}
        role="dialog" aria-modal="true" aria-label={t.common.mobileNav}
      >
        <div className="flex h-[72px] items-center justify-between border-b border-border px-5">
          <span className="text-[15px] font-semibold text-fg">{t.common.menu}</span>
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-primary-light hover:text-primary" onClick={() => setMobileOpen(false)} aria-label={t.header.closeMenu}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex flex-col gap-0.5 p-4" aria-label={t.common.mobileNav}>
          {[
            { label: t.nav.features, href: "/#features" },
            { label: t.nav.howItWorks, href: "/#how-it-works" },
            { label: t.nav.faq, href: "/#faq" },
          ].map((link) => (
            <a key={link.label} href={link.href} onClick={handleNavClick} className="rounded-xl px-4 py-3 text-[15px] font-medium text-fg transition-colors hover:bg-primary-light hover:text-primary">
              {link.label}
            </a>
          ))}
          <div className="my-3 border-t border-border-light" />
          <Link href="/#hero" onClick={handleNavClick} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-[15px] font-semibold text-white shadow-[0_2px_8px_rgba(124,77,245,0.25)] transition-all hover:bg-primary-hover active:scale-[0.97]">
            <Download className="h-4 w-4" />
            {t.common.startDownloading}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </nav>
      </div>
    </>
  );
}
