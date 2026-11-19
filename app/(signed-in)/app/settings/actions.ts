"use server";

import { refresh } from "next/cache";
import { ownerContext } from "@/server/auth/require-owner";
import { APPLY_ATS, setPlatformMode } from "@/server/modules/apply/apply.service";
import { ValidationError } from "@/server/core/errors";
import { setPublicHandle, setPublicPageEnabled } from "@/server/modules/public-page/public-page.service";
import { setLinkedInResume } from "@/server/modules/apply/linkedin-resume";
import { removePushSubscription, savePushSubscription, sendPush, type BrowserSubscription } from "@/server/modules/notifications/push";
import { setDigestSettings } from "@/server/modules/notifications/notifications.service";

/** Chooses the resume LinkedIn applications send (field `onFile` = "true": the one on LinkedIn; else tailored). */
export async function setLinkedInResumeAction(formData: FormData) {
  const { db, owner } = await ownerContext();
  await setLinkedInResume(db, owner.id, formData.get("onFile") === "true");
  refresh();
}

/** Switches an apply platform between supervised and auto (fields `ats`, `mode`). */
export async function setPlatformModeAction(formData: FormData) {
  const { db, owner } = await ownerContext();
  const ats = String(formData.get("ats"));
  if (!(APPLY_ATS as readonly string[]).includes(ats)) return;
  await setPlatformMode(db, owner.id, ats, formData.get("mode") === "auto" ? "auto" : "supervised");
  refresh();
}

/** Turns the public status page on or off (form field `enabled` = "true" | "false"). */
export async function setPublicPageAction(formData: FormData) {
  const { db, owner } = await ownerContext();
  await setPublicPageEnabled(db, owner.id, formData.get("enabled") === "true");
  refresh();
}

/** State of the handle form: an error, or the saved handle. */
export type HandleState = { error?: string; saved?: string };

/** Sets the handle in the public page's address, /u/<handle> (form field `handle`). */
export async function setPublicHandleAction(_prev: HandleState, formData: FormData): Promise<HandleState> {
  const { db, owner } = await ownerContext();
  try {
    const saved = await setPublicHandle(db, owner.id, String(formData.get("handle") ?? ""));
    refresh();
    return { saved };
  } catch (err) {
    if (err instanceof ValidationError) return { error: err.message };
    throw err;
  }
}

/** Turns phone alerts on in this browser: saves its push subscription. */
export async function savePushSubscriptionAction(sub: BrowserSubscription, device: string): Promise<void> {
  const { db, owner } = await ownerContext();
  await savePushSubscription(db, owner.id, sub, device);
  refresh();
}

/** Turns phone alerts off in this browser. */
export async function removePushSubscriptionAction(endpoint: string): Promise<void> {
  const { db, owner } = await ownerContext();
  await removePushSubscription(db, owner.id, endpoint);
  refresh();
}

/** Sends a test alert to every browser alerts are on in; answers how many it reached. */
export async function sendTestPushAction(): Promise<number> {
  const { db, owner } = await ownerContext();
  return sendPush(db, owner.id, { title: "Jobrx alerts are on", body: "You'll hear here when the runner needs you, or a company writes back.", href: "/app/applying", tag: "test" });
}

/** State of the daily email form: an error, or that it saved. */
export type DigestState = { error?: string; saved?: boolean };

/** Saves the daily email: on or off, its time and time zone (fields `digest`, `digest_time`, `timezone`). */
export async function setDigestAction(_prev: DigestState, formData: FormData): Promise<DigestState> {
  const { db, owner } = await ownerContext();
  try {
    await setDigestSettings(db, owner.id, {
      digest: formData.get("digest") === "off" ? "off" : "daily",
      digest_time: String(formData.get("digest_time") ?? ""),
      timezone: String(formData.get("timezone") ?? ""),
    });
    refresh();
    return { saved: true };
  } catch (err) {
    if (err instanceof ValidationError) return { error: err.message };
    throw err;
  }
}
