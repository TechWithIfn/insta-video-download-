import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Downloadit — Instagram Media Downloader",
    short_name: "Downloadit",
    description: "Download public Instagram videos, Reels and photos with Downloadit.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f4fa",
    theme_color: "#7c4df5",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}