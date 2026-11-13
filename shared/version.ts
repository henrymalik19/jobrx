// The app's version: the commit it was built from and when (set at build time in next.config.ts from Vercel's
// build variables, or git when built locally). Shown in the sidebar and on Settings, next to the apply runner's.

/** The commit the app was built from, its message's first line, and when it was built (deployed). */
export const APP_VERSION = {
  sha: process.env.APP_VERSION_SHA ?? "",
  message: process.env.APP_VERSION_MESSAGE ?? "",
  builtAt: process.env.APP_BUILT_AT ?? "",
};

/** A commit's short form, as GitHub shows it ("dev" when unknown). */
export const shortSha = (sha: string) => (sha ? sha.slice(0, 7) : "dev");
