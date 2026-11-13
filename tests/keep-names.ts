// Compiles the project's TypeScript the way the workers run it: tsx uses esbuild with keepNames, which
// wraps named functions in a `__name(...)` helper. A function handed to Playwright's page.evaluate runs in
// the page, where that helper doesn't exist, so it throws "__name is not defined" in the runner only. Vite
// compiles with oxc, which never adds it; this plugin compiles first with esbuild, so the tests fail the
// same way the runner would.
import { transform } from "esbuild";
import type { Plugin } from "vitest/config";

/** A Vite plugin compiling the project's .ts/.tsx files with esbuild and keepNames, as tsx does. */
export function keepNames(): Plugin {
  return {
    name: "keep-names-like-tsx",
    enforce: "pre",
    async transform(code, id) {
      const file = id.split("?")[0];
      if (file.includes("/node_modules/") || !/\.tsx?$/.test(file)) return null;
      const out = await transform(code, {
        loader: file.endsWith(".tsx") ? "tsx" : "ts",
        format: "esm",
        target: "esnext",
        keepNames: true,
        jsx: "automatic",
        sourcemap: true,
        sourcefile: file,
      });
      return { code: out.code, map: out.map };
    },
  };
}
