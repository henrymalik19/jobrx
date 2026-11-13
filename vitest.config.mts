import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { keepNames } from "./tests/keep-names.mts";

export default defineConfig({
  // Compiled as the workers run it (tsx), so code that breaks only there breaks here too.
  plugins: [keepNames()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "workers/**/*.test.ts"],
    environment: "node",
  },
});
