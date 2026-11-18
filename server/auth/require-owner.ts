import "server-only";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/server/db/service-client";
import { createUserClient } from "@/server/db/user-client";
import type { Db } from "@/server/db/types";
import { serverEnv } from "@/shared/env";
import { isActiveMember, isOwner } from "./session";

/** The signed-in user: the owner of the workspace they're looking at (the app's owner, or a member). */
export type Owner = { id: string; email: string | undefined };

/** What every signed-in page and action works with: who is signed in, and a client acting as them. */
export type OwnerContext = { owner: Owner; db: Db };

/**
 * Authorization gate for every signed-in page, server action and route handler. Redirects to the login page
 * when nobody is signed in, and signs out anyone who isn't a member (or whose access was removed). RLS then
 * keeps each person to their own rows.
 *
 * @returns The signed-in user plus an RLS-bound client to hand to services.
 */
export async function ownerContext(): Promise<OwnerContext> {
  const db = await createUserClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) redirect("/login");
  if (!(await isActiveMember(db))) {
    await db.auth.signOut();
    redirect("/login?error=no_access");
  }
  return { owner: { id: data.user.id, email: data.user.email }, db };
}

/** Like {@link ownerContext} when only the user (not the client) is needed. */
export async function requireOwner(): Promise<Owner> {
  return (await ownerContext()).owner;
}

/** Gate for Admin's pages and actions: the app's owner only; members go back to their workspace. */
export async function requireAdmin(): Promise<OwnerContext> {
  const ctx = await ownerContext();
  if (!(await isOwner(ctx.db))) redirect("/app");
  return ctx;
}

/**
 * For admin pages that look at any user's data: the owner check first, then a client that reads every user's
 * rows (service role, bypassing RLS). Never use it outside /admin, where regular pages rely on reading only
 * the signed-in user's rows.
 */
export async function adminContext(): Promise<OwnerContext & { admin: Db }> {
  const ctx = await requireAdmin();
  return { ...ctx, admin: createServiceClient(serverEnv()) };
}
