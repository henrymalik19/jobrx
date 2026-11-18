import "server-only";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createUserClient } from "@/server/db/user-client";
import type { Db } from "@/server/db/types";

/** Outcome of a sign-in or password change; `error` is safe to show to the user. */
export type SignInResult = { ok: true } | { ok: false; error: string };

/** Whether the signed-in user may use the app: they're in `users` and their access wasn't removed. */
export async function isActiveMember(db: Db): Promise<boolean> {
  const { data, error } = await db.rpc("is_member");
  return !error && data === true;
}

/** Whether the signed-in user runs the app (role "owner"): Admin is theirs alone. */
export async function isOwner(db: Db): Promise<boolean> {
  const { data, error } = await db.rpc("is_owner");
  return !error && data === true;
}

/**
 * Signs in with email and password and keeps the session only for a member whose access wasn't removed.
 * Any other account is signed straight back out.
 *
 * @param email - Login email.
 * @param password - Login password (never logged).
 */
export async function signInMember(email: string, password: string): Promise<SignInResult> {
  const db = await createUserClient();
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { ok: false, error: "Sign-in failed." };
  if (!(await isActiveMember(db))) {
    await db.auth.signOut();
    return { ok: false, error: "This account doesn't have access." };
  }
  return { ok: true };
}

/** Ends the current session (clears the auth cookies). */
export async function signOutCurrentUser(): Promise<void> {
  const db = await createUserClient();
  await db.auth.signOut();
}

/**
 * Emails a password-reset link. Supabase sends it only if the account exists,
 * and only to `redirectTo` if that URL is in Auth's redirect allow list
 * (otherwise it falls back to the Site URL).
 */
export async function sendPasswordReset(email: string, redirectTo: string): Promise<void> {
  const db = await createUserClient();
  await db.auth.resetPasswordForEmail(email, { redirectTo });
}

/** Turns the code from an emailed link (password reset) into a session; false if it is invalid or expired. */
export async function exchangeAuthCode(code: string): Promise<boolean> {
  const db = await createUserClient();
  const { error } = await db.auth.exchangeCodeForSession(code);
  return !error;
}

/** Turns the token in an emailed link (an invite) into a session; false if it is invalid, used or expired. */
export async function verifyEmailToken(tokenHash: string, type: EmailOtpType): Promise<boolean> {
  const db = await createUserClient();
  const { error } = await db.auth.verifyOtp({ token_hash: tokenHash, type });
  return !error;
}

/**
 * Sets a new password for the signed-in member (after a reset or invite link signed them in).
 *
 * @param password - The new password (never logged).
 */
export async function updatePassword(password: string): Promise<SignInResult> {
  const db = await createUserClient();
  const { data } = await db.auth.getUser();
  if (!data.user || !(await isActiveMember(db))) {
    return { ok: false, error: "The link has expired. Request a new one." };
  }
  const { error } = await db.auth.updateUser({ password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
