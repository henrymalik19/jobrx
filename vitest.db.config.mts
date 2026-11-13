import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { keepNames } from "./tests/keep-names";

// Database integration tests. Requires a running local Supabase (`pnpm db:start`).
export default defineConfig({
  // Compiled as the workers run it (tsx), so code that breaks only there breaks here too.
  plugins: [keepNames()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/db/setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
