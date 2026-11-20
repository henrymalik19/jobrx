// Builds the desktop app into dist/: the app itself (src/main.ts) and the apply runner (workers/apply.ts), each one
// file, with the repo's own code and packages inside. Playwright stays a package of its own (it isn't bundleable),
// installed in this folder. Run from anywhere; the repo's packages must be installed (pnpm install at the root).
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(here, "dist");
const git = (...args) => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  absWorkingDir: root,
  tsconfig: path.join(root, "tsconfig.json"),
  external: ["electron", "playwright-core"],
  logLevel: "warning",
  // The code it was built from, which the runner reports (Settings shows it next to the web app's).
  define: {
    __BUILD_SHA__: JSON.stringify(process.env.GITHUB_SHA || git("rev-parse", "HEAD")),
    __BUILD_MESSAGE__: JSON.stringify(git("log", "-1", "--format=%s").slice(0, 200)),
  },
};
await build({ ...common, entryPoints: [path.join(here, "src/main.ts")], outfile: path.join(dist, "main.cjs") });
await build({ ...common, entryPoints: [path.join(root, "workers/apply.ts")], outfile: path.join(dist, "runner.cjs") });
for (const file of ["preload.cjs", "signin.html", "log.html"]) await cp(path.join(here, "src", file), path.join(dist, file));
await cp(path.join(here, "build/icon.png"), path.join(dist, "icon.png"));
console.log("built desktop/dist");
