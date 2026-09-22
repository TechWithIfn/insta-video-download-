import type { Metadata, Viewport } from "next";
import { Poppins, Lora } from "next/font/google";
import { LanguageProvider } from "@/i18n";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["italic"],
});

export const metadata: Metadata = {
  title: "Downloadit — Save Instagram Content",
  description:
    "Save public Instagram posts, reels, videos, photos, stories and highlights from a simple link. No login required.",
  openGraph: {
    title: "Downloadit — Save Instagram Content",
    description:
      "Save public Instagram posts, reels, videos, photos, stories and highlights from a simple link.",
    type: "website",
    siteName: "Downloadit",
  },
  twitter: {
    card: "summary_large_image",
    title: "Downloadit — Save Instagram Content",
    description:
      "Save public Instagram posts, reels, videos, photos, stories and highlights from a simple link.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0c1b" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${lora.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try {
                  // Dark Mode ONLY on explicit saved user choice.
                  // No saved preference (or anything else) => Light Mode.
                  // System/OS theme is deliberately ignored.
                  var t = localStorage.getItem('downloadit-theme');
                  if (t === 'dark') {
                    document.documentElement.setAttribute('data-theme','dark');
                  } else {
                    document.documentElement.setAttribute('data-theme','light');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
