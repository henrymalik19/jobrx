// The end-to-end tests' own world: the local Supabase stack (never a hosted one) and a test user of their own,
// separate from your local owner, so the tests never touch your data and never need your password.
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import type { Db } from "@/server/db/types";

/**
 * The test user: made in the local Supabase stack before the tests and removed after them (left behind, it
 * would be one more user for the database tests). A fixed id, so the app server knows it before it exists.
 * The password is a test value, not a secret.
 */
export const E2E_USER = { id: "0e2e0000-0000-4000-8000-000000000001", email: "e2e@jobrx.test", password: "e2e-local-only-password" } as const;

/** The port the tests' own app server listens on (beside your `pnpm dev` on 3000). */
export const E2E_PORT = 3100;

/** The local stack's URL and keys, from `supabase status`; refuses anything that isn't local. */
export function localSupabase(): { url: string; anonKey: string; serviceRoleKey: string } {
  const out = execSync("pnpm exec supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const s = JSON.parse(out.slice(out.indexOf("{")));
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(s.API_URL ?? "")) throw new Error("local Supabase is not running (pnpm db:start)");
  return { url: s.API_URL, anonKey: s.ANON_KEY, serviceRoleKey: s.SERVICE_ROLE_KEY };
}

/** A service-role client for the local stack, to set up and check the tests' data. */
export function localAdmin(): Db {
  const { url, serviceRoleKey } = localSupabase();
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } }) as unknown as Db;
}

/** Makes the test user afresh (and its `users` row, as a member), removing one a stopped run left. */
export async function createE2EUser(db: Db): Promise<void> {
  await removeE2EUser(db);
  const { error } = await db.auth.admin.createUser({ id: E2E_USER.id, email: E2E_USER.email, password: E2E_USER.password, email_confirm: true });
  if (error) throw error;
  const { error: e } = await db.from("users").insert({ id: E2E_USER.id, role: "member" });
  if (e) throw e;
}

/** Removes the test user and everything it owns (its rows go with it), found by its email whatever its id. */
export async function removeE2EUser(db: Db): Promise<void> {
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  for (const u of data.users.filter((x) => x.email === E2E_USER.email)) {
    await db.from("users").delete().eq("id", u.id);
    const { error: e } = await db.auth.admin.deleteUser(u.id);
    if (e) throw e;
  }
}
