"use server";

import { ValidationError } from "@/server/core/errors";
import { createServiceClient } from "@/server/db/service-client";
import { requestAccess } from "@/server/modules/members/members.service";
import { serverEnv } from "@/shared/env";

/** Request-access form state: sent, or what to fix (with what was typed, kept). */
export type RequestState = { sent?: boolean; error?: string; values?: { name: string; email: string; note: string } };

/**
 * Saves a request to join; the owner is told in the app. Bots that fill the hidden `website` field are thanked
 * and dropped.
 */
export async function requestAccessAction(_prev: RequestState, formData: FormData): Promise<RequestState> {
  const values = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    note: String(formData.get("note") ?? ""),
  };
  if (String(formData.get("website") ?? "")) return { sent: true };
  try {
    await requestAccess(createServiceClient(serverEnv()), values);
  } catch (err) {
    if (err instanceof ValidationError) return { error: err.message, values };
    throw err;
  }
  return { sent: true };
}
