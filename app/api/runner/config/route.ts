// The desktop app asks here where Jobrx's database is: the same public values the web app's pages already carry
// (the URL and the anon key, which the database's row rules make safe to hand out), so the app needs no
// settings file and follows the database if it moves.
import { serverEnv } from "@/shared/env";

/** The database's public address and key, for the desktop app's apply runner. */
export function GET(): Response {
  const env = serverEnv();
  return Response.json({ supabaseUrl: env.SUPABASE_URL, supabaseAnonKey: env.SUPABASE_ANON_KEY }, { headers: { "cache-control": "public, max-age=300" } });
}
