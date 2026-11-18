// Members: who may use Jobrx besides the owner. People ask to join from the sign-in page ("Request access"),
// the owner invites them from Admin > Users (or invites anyone directly), and can remove and restore their
// access. Invited members start in their own empty workspace, following the owner's boards.
//
// Everything here uses the service-role client: requests come from people who aren't signed in, and inviting
// or removing someone is the owner's alone (callers check that with requireAdmin()).
import { z } from "zod";
import type { User as AuthUser } from "@supabase/supabase-js";
import type { Db } from "@/server/db/types";
import { check, unwrap, ValidationError } from "@/server/core/errors";
import { followCompanies } from "@/server/modules/companies/companies.repository";
import { notify } from "@/server/modules/notifications/in-app";
import { ownerId } from "@/server/modules/users/users.service";

/** How long a removed member stays banned in Supabase Auth: effectively for good, until restored. */
const BANNED_FOR = "876000h";

const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

/** What the "Request access" form sends. */
export const accessRequestInput = z.object({
  email,
  name: z.string().trim().min(1, "Enter your name.").max(120),
  note: z.string().trim().max(1000).optional().transform((v) => v || null),
});

/** A request to join, as Admin shows it. */
export type AccessRequest = { id: string; email: string; name: string; note: string | null; createdAt: string };

/** Where someone stands: invited (hasn't set a password yet), active, or removed. */
export type MemberStatus = "invited" | "active" | "removed";

/** Someone's sign-in account, as Admin > Users shows it beside their applications. */
export type Account = { email: string | null; status: MemberStatus; invitedAt: string | null; lastSignInAt: string | null };

/**
 * Saves a request to join and tells the owner (in-app notification). Asking again while a request waits changes
 * nothing, and the answer is the same either way, so the form can't be used to find out who has an account.
 */
export async function requestAccess(db: Db, input: z.input<typeof accessRequestInput>): Promise<void> {
  const parsed = accessRequestInput.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const { error } = await db.from("access_requests").insert(parsed.data);
  if (error?.code === "23505") return; // one is already waiting
  check({ error }, "save access request");
  const owner = await ownerId(db);
  if (owner) {
    await notify(db, owner, {
      kind: "access_request",
      title: `${parsed.data.name} asked to join`,
      body: parsed.data.email,
      href: "/admin/users",
      dedupeKey: `access_request:${parsed.data.email}`,
    });
  }
}

/** Requests waiting for an answer, oldest first. */
export async function listAccessRequests(db: Db): Promise<AccessRequest[]> {
  const rows = unwrap(
    await db.from("access_requests").select("id, email, name, note, created_at").eq("status", "pending").order("created_at"),
    "list access requests",
  );
  return rows.map((r) => ({ id: r.id, email: r.email, name: r.name, note: r.note, createdAt: r.created_at }));
}

/** Turns a request down (they aren't told). */
export async function declineAccessRequest(db: Db, id: string): Promise<void> {
  check(
    await db.from("access_requests").update({ status: "declined", decided_at: new Date().toISOString() }).eq("id", z.string().uuid().parse(id)).eq("status", "pending"),
    "decline access request",
  );
}

/** Every sign-in account, by id (there are few: one page is plenty). */
async function authUsers(db: Db): Promise<Map<string, AuthUser>> {
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return new Map(data.users.map((u) => [u.id, u]));
}

/** Where an account stands. */
export function memberStatus(user: Pick<AuthUser, "email_confirmed_at" | "last_sign_in_at"> | undefined, removedAt: string | null): MemberStatus {
  if (removedAt) return "removed";
  return user?.email_confirmed_at || user?.last_sign_in_at ? "active" : "invited";
}

/** Each user's account (email and where they stand), for Admin > Users. */
export async function listAccounts(db: Db): Promise<Map<string, Account>> {
  const [users, auth] = await Promise.all([
    db.from("users").select("id, removed_at").then((r) => unwrap(r, "list users")),
    authUsers(db),
  ]);
  return new Map(
    users.map((u) => {
      const a = auth.get(u.id);
      return [u.id, { email: a?.email ?? null, status: memberStatus(a, u.removed_at), invitedAt: a?.invited_at ?? null, lastSignInAt: a?.last_sign_in_at ?? null }];
    }),
  );
}

/**
 * Invites someone: Supabase emails them a link (the "Invite user" template, supabase/templates/invite.html) to
 * /auth/confirm on the Site URL, which signs them in and opens /login/welcome to choose a password. They become a member following the owner's boards, and a request from
 * the same address is marked invited. Inviting someone who was invited but hasn't joined sends a fresh link.
 *
 * @returns The new member's id.
 */
export async function inviteMember(db: Db, rawEmail: string): Promise<string> {
  const parsed = email.safeParse(rawEmail);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const address = parsed.data;

  const existing = [...(await authUsers(db)).values()].find((u) => u.email?.toLowerCase() === address);
  if (existing) {
    const row = unwrap(await db.from("users").select("removed_at").eq("id", existing.id).limit(1), "find user")[0];
    if (row?.removed_at) throw new ValidationError(`${address} was removed. Restore their access instead.`);
    if (row && memberStatus(existing, null) === "active") throw new ValidationError(`${address} already has access.`);
  }

  const { data, error } = await db.auth.admin.inviteUserByEmail(address);
  if (error || !data.user) throw new ValidationError(`Couldn't send the invite: ${error?.message ?? "no user came back"}.`);
  const id = data.user.id;

  check(await db.from("users").upsert({ id, role: "member" }, { onConflict: "id", ignoreDuplicates: true }), "add member");
  const owner = await ownerId(db);
  if (owner && owner !== id) {
    const boards = unwrap(await db.from("user_companies").select("company_id").eq("user_id", owner), "list the owner's boards");
    await followCompanies(db, id, boards.map((b) => b.company_id));
  }
  check(
    await db.from("access_requests").update({ status: "invited", decided_at: new Date().toISOString() }).ilike("email", address).eq("status", "pending"),
    "mark request invited",
  );
  return id;
}

/** The member a removal or restore is for; never the owner. */
async function member(db: Db, userId: string): Promise<string> {
  const id = z.string().uuid().parse(userId);
  const row = unwrap(await db.from("users").select("role").eq("id", id).limit(1), "find member")[0];
  if (!row) throw new ValidationError("No such member.");
  if (row.role === "owner") throw new ValidationError("The owner's access can't be removed.");
  return id;
}

/**
 * Removes a member's access, keeping their data: they're banned from signing in (which also stops their session
 * from refreshing), every page and table turns them away, and the workers skip them.
 */
export async function removeAccess(db: Db, userId: string): Promise<void> {
  const id = await member(db, userId);
  check(await db.from("users").update({ removed_at: new Date().toISOString() }).eq("id", id), "remove access");
  const { error } = await db.auth.admin.updateUserById(id, { ban_duration: BANNED_FOR });
  if (error) throw error;
}

/** Gives a removed member their access back, with everything as they left it. */
export async function restoreAccess(db: Db, userId: string): Promise<void> {
  const id = await member(db, userId);
  const { error } = await db.auth.admin.updateUserById(id, { ban_duration: "none" });
  if (error) throw error;
  check(await db.from("users").update({ removed_at: null }).eq("id", id), "restore access");
}
