import "server-only";
import type { Db } from "@/server/db/types";

/**
 * Whether a user runs the app (role "owner"): what only they see, like the version in the sidebar. Everyone
 * else is a member.
 *
 * @param db - The user's own client (a user reads their own row).
 */
export async function isAdmin(db: Db, userId: string): Promise<boolean> {
  const { data } = await db.from("users").select("role").eq("id", userId).maybeSingle();
  return data?.role === "owner";
}
