// Starts the app for the end-to-end tests (Playwright's webServer runs this): `next dev` on its own port and
// build folder, against the local Supabase stack, letting in only the test user (global-setup.ts makes it).
// Claude is pointed at a closed port, so nothing the tests click spends money or leaves the machine.
import { spawn } from "node:child_process";
import { E2E_PORT, E2E_USER, localSupabase } from "./local";

const { url, anonKey, serviceRoleKey } = localSupabase();
const env = {
  ...process.env,
  SUPABASE_URL: url,
  SUPABASE_ANON_KEY: anonKey,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  OWNER_USER_ID: E2E_USER.id,
  // Its own build folder, so it runs beside your `pnpm dev`.
  NEXT_DIST_DIR: ".next-e2e",
  ANTHROPIC_API_KEY: "e2e-no-claude",
  ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
  RAILWAY_TOKEN: "",
};
// One command line: Windows needs a shell to find pnpm, and the port is a number, nothing to escape.
const next = spawn(`pnpm exec next dev --port ${E2E_PORT}`, { env, stdio: "inherit", shell: true });
const stop = () => next.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
next.on("exit", (code) => process.exit(code ?? 0));
