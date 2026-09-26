import type { Metadata, Viewport } from "next";
import { Poppins, Lora } from "next/font/google";
import Script from "next/script";
import { LanguageProvider } from "@/i18n";
import {
  BRAND_DESCRIPTION,
  BRAND_NAME,
  BRAND_TITLE,
  HOME_OG_IMAGE_ALT,
  SITE_URL,
} from "@/config/site";
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
  metadataBase: new URL(SITE_URL),
  title: {
    default: BRAND_TITLE,
    template: `%s | ${BRAND_NAME}`,
  },
  description: BRAND_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: BRAND_TITLE,
    description: BRAND_DESCRIPTION,
    type: "website",
    siteName: BRAND_NAME,
    url: SITE_URL,
    locale: "en_US",
    images: [
      {
        url: "/og-downloadit.png",
        width: 1200,
        height: 630,
        alt: HOME_OG_IMAGE_ALT,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: BRAND_TITLE,
    description: BRAND_DESCRIPTION,
    images: ["/og-downloadit.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
    ],
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    shortcut: "/favicon.ico",
  },
  manifest: "/manifest.webmanifest",
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
    {
      media: "(prefers-color-scheme: light)",
      color: "#f5f4fa",
    },
    {
      media: "(prefers-color-scheme: dark)",
      color: "#0e0c1b",
    },
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
        {/* Google AdSense */}
        <Script
          id="google-adsense"
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8543183124286362"
          crossOrigin="anonymous"
        />

        {/* Website Structured Data */}
        <Script
          id="website-structured-data"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: BRAND_NAME,
              alternateName: [
                "Downloadit.pro",
                "Downloadit Instagram Downloader",
              ],
              url: SITE_URL,
            }),
          }}
        />

        {/* Organization Structured Data */}
        <Script
          id="organization-structured-data"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: BRAND_NAME,
              url: SITE_URL,
              logo: `${SITE_URL}/og-downloadit.png`,
            }),
          }}
        />

        {/* Web Application Structured Data */}
        <Script
          id="webapp-structured-data"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: BRAND_NAME,
              url: SITE_URL,
              applicationCategory: "MultimediaApplication",
              operatingSystem: "Any",
              description: BRAND_DESCRIPTION,
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
            }),
          }}
        />

        {/* Theme Initialization */}
        <Script
          id="downloadit-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try {
                  // Dark Mode ONLY on explicit saved user choice.
                  // No saved preference (or anything else) => Light Mode.
                  // System/OS theme is deliberately ignored.
                  var t = localStorage.getItem('downloadit-theme');

                  if (t === 'dark') {
                    document.documentElement.setAttribute('data-theme', 'dark');
                  } else {
                    document.documentElement.setAttribute('data-theme', 'light');
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