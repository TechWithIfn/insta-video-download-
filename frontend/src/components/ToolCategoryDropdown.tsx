"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Video, Image as ImageIcon, Clock, Music2 } from "lucide-react";

export type DropdownToolItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
  iconBg: string;
  iconColor: string;
};

export const DROPDOWN_TOOLS: DropdownToolItem[] = [
  {
    href: "/instagram-video-downloader",
    label: "Instagram Video Downloader",
    icon: Video,
    iconBg: "rgba(124, 77, 245, 0.12)",
    iconColor: "var(--primary)",
  },
  {
    href: "/instagram-photo-downloader",
    label: "Instagram Photo Downloader",
    icon: ImageIcon,
    iconBg: "rgba(245, 142, 91, 0.14)",
    iconColor: "#f58e5b",
  },
  {
    href: "/instagram-story-downloader",
    label: "Instagram Story Downloader",
    icon: Clock,
    iconBg: "rgba(14, 165, 233, 0.12)",
    iconColor: "#0ea5e9",
  },
  {
    href: "/instagram-audio-downloader",
    label: "Instagram Audio Downloader",
    icon: Music2,
    iconBg: "rgba(16, 185, 129, 0.12)",
    iconColor: "#10b981",
  },
];

export default function ToolCategoryDropdown() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isReelsActive = pathname === "/instagram-reels-downloader" || pathname === "/";

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen((prev) => !prev);
  };

  const close = () => setOpen(false);

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      {/* Primary visible downloader: Instagram Reels Downloader with clearly clickable arrow */}
      <div
        className={`inline-flex items-center rounded-full transition-all duration-200 border ${
          isReelsActive || open
            ? "bg-primary-light text-primary border-primary/25 shadow-xs"
            : "border-transparent text-fg-muted hover:bg-primary-light hover:text-primary"
        }`}
      >
        <Link
          href="/instagram-reels-downloader"
          onClick={close}
          className="px-3 py-1.5 text-[14.5px] font-semibold transition-colors focus-visible:outline-none"
        >
          Instagram Reels Downloader
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Toggle Instagram downloaders menu"
          className="flex h-8 w-8 items-center justify-center rounded-full pr-1 text-fg-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ChevronDown
            className="h-4 w-4 transition-transform duration-200"
            style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
            strokeWidth={2.2}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Clean premium glassmorphism dropdown directly below */}
      {open && (
        <div
          role="menu"
          aria-label="Instagram downloaders"
          className="absolute left-0 top-full z-50 mt-2 w-[270px] overflow-hidden rounded-2xl p-1.5 backdrop-blur-xl animate-fade-in"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            boxShadow: "0 14px 40px rgba(60, 40, 120, 0.12), 0 4px 12px rgba(0, 0, 0, 0.05)",
          }}
        >
          <div className="space-y-1">
            {DROPDOWN_TOOLS.map((tool) => {
              const Icon = tool.icon;
              const isSelected = pathname === tool.href;
              return (
                <Link
                  key={tool.href}
                  href={tool.href}
                  role="menuitem"
                  tabIndex={0}
                  onClick={close}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-all duration-150 ${
                    isSelected
                      ? "bg-primary-light text-primary font-semibold"
                      : "text-fg hover:bg-primary-light hover:text-primary"
                  }`}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: tool.iconBg, color: tool.iconColor }}
                  >
                    <Icon size={15} strokeWidth={2.2} />
                  </span>
                  <span className="truncate">{tool.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
