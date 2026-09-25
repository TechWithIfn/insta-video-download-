import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 text-center">
      <p className="text-[80px] font-bold leading-none tracking-tight text-fg">404</p>
      <h1 className="mt-5 text-xl font-semibold text-fg">Page not found</h1>
      <p className="mt-3 max-w-sm text-[16px] leading-relaxed text-fg-muted">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-7 py-3 text-sm font-semibold text-white shadow-[0_2px_8px_rgba(67,56,202,0.25)] transition-all hover:bg-primary-hover hover:shadow-[0_4px_12px_rgba(67,56,202,0.35)] active:scale-[0.97]"
      >
        Go Home
      </Link>
    </div>
  );
}
