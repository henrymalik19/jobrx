// The web app manifest: what lets Jobrx be added to a phone's home screen and open like an app (needed on an
// iPhone for phone alerts).
import type { MetadataRoute } from "next";

/** Jobrx as an installable app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jobrx",
    short_name: "Jobrx",
    description: "Your job search, on autopilot.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#6366f1",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
