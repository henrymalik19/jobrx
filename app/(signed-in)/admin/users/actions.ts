"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/server/auth/require-owner";
import { ValidationError } from "@/server/core/errors";
import { createServiceClient } from "@/server/db/service-client";
import { declineAccessRequest, inviteMember, removeAccess, restoreAccess } from "@/server/modules/members/members.service";
import { serverEnv } from "@/shared/env";

/** An invite form's state: who was invited, or what went wrong. */
export type InviteState = { ok?: string; error?: string };

/** The owner's service client for member changes (after checking it's the owner). */
async function adminDb() {
  await requireAdmin();
  return createServiceClient(serverEnv());
}

/** Turns a service error into form state; anything unexpected is rethrown to the error boundary. */
function toError(err: unknown): InviteState {
  if (err instanceof ValidationError) return { error: err.message };
  throw err;
}

/** Invites the typed (or requested) email: Supabase sends the invite. */
export async function inviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const db = await adminDb();
  const email = String(formData.get("email") ?? "");
  try {
    await inviteMember(db, email);
  } catch (err) {
    return toError(err);
  }
  refresh();
  return { ok: `Invite sent to ${email.trim()}.` };
}

/** Declines a request to join. */
export async function declineAction(formData: FormData) {
  await declineAccessRequest(await adminDb(), String(formData.get("id")));
  refresh();
}

/** Removes a member's access (their data stays). */
export async function removeAction(formData: FormData) {
  await removeAccess(await adminDb(), String(formData.get("id")));
  refresh();
}

/** Gives a removed member their access back. */
export async function restoreAction(formData: FormData) {
  await restoreAccess(await adminDb(), String(formData.get("id")));
  refresh();
}
