import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

/** Git's answer, or "" when there's no git (or no repository). */
const git = (...args: string[]) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

const nextConfig: NextConfig = {
  // The version the app shows (shared/version.ts): the commit it was built from (Vercel's build variables, else
  // git) and when it was built.
  env: {
    APP_VERSION_SHA: process.env.VERCEL_GIT_COMMIT_SHA || git("rev-parse", "HEAD"),
    APP_VERSION_MESSAGE: (process.env.VERCEL_GIT_COMMIT_MESSAGE || git("log", "-1", "--format=%s")).split("\n")[0].slice(0, 200),
    APP_BUILT_AT: new Date().toISOString(),
  },
  cacheComponents: true,
  partialPrefetching: true,
  // Review and Needs you became the To do page and Companies moved to Admin; old links (digest emails) still land.
  async redirects() {
    return [
      { source: "/app/review", destination: "/app/todo?tab=ready", permanent: false },
      { source: "/app/needs-you", destination: "/app/todo?tab=answers", permanent: false },
      { source: "/app/companies", destination: "/admin/companies", permanent: false },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
