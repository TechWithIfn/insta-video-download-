import type { ReactNode } from "react";
import Link from "next/link";
import { SUPPORT_MAILTO, SUPPORT_EMAIL } from "@/config/site";

export default function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-[720px] px-4 pb-20 pt-28 sm:px-6 sm:pt-36">
      <Link
        href="/"
        className="inline-flex min-h-[44px] items-center text-[14px] font-semibold text-fg-muted transition-colors hover:text-primary"
      >
        ← Back to home
      </Link>
      <h1 className="mt-4 text-[clamp(26px,4vw,40px)] font-bold tracking-[-0.02em] text-fg">
        {title}
      </h1>
      <p className="mt-2 text-[13.5px] text-fg-subtle">Last updated: {updated}</p>
      <div className="mt-6 flex flex-col gap-4 text-[15px] leading-[1.75] text-fg-muted">
        {children}
      </div>
      <p className="mt-8 text-[15px] text-fg-muted">
        Questions about this page? Contact us at{" "}
        <a
          href={SUPPORT_MAILTO}
          className="inline-flex min-h-[44px] items-center font-semibold text-fg transition-colors hover:text-primary"
        >
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </section>
  );
}
