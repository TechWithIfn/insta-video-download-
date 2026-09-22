import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/help", "/privacy", "/terms", "/dmca", "/disclaimer", "/_next/static/", "/favicon.svg"],
        disallow: ["/api/", "/_next/webpack-hmr", "/_next/image"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}