"use server";

import { refresh } from "next/cache";
import { ownerContext } from "@/server/auth/require-owner";
import { ValidationError } from "@/server/core/errors";
import { createClaudeCaller, DRAFTING_MODEL } from "@/server/integrations/anthropic/claude";
import { approveApplication, IllegalTransitionError, skipApplication } from "@/server/modules/applications/applications.service";
import { ensureResume } from "@/server/modules/prepare/prepare.service";
import type { EmailKind } from "@/server/modules/tracking/classify";
import { dismissEmail, linkEmail } from "@/server/modules/tracking/tracking.service";

/** Links an email to an application (saying what it is, for an unsorted one) and moves it; returns an error message or null. */
export async function linkEmailAction(emailId: string, applicationId: string, kind?: EmailKind): Promise<string | null> {
  const { db, owner } = await ownerContext();
  try {
    await linkEmail(db, owner.id, emailId, applicationId, kind);
  } catch (err) {
    if (err instanceof ValidationError) return err.message;
    if (err instanceof IllegalTransitionError) return "Linked, but that application can't move that way from its current status.";
    throw err;
  }
  refresh();
  return null;
}

/** Marks an unmatched email as not about any application. */
export async function dismissEmailAction(emailId: string): Promise<void> {
  const { db, owner } = await ownerContext();
  await dismissEmail(db, owner.id, emailId);
  refresh();
}


/** Approves an application from its To do row (as Approve on its page does); returns an error message or null. */
export async function quickApproveAction(applicationId: string): Promise<string | null> {
  const { db, owner } = await ownerContext();
  try {
    // As on its page: the resume is made first when it's missing or out of date.
    await ensureResume({ db, userId: owner.id, call: createClaudeCaller(DRAFTING_MODEL) }, applicationId).catch(() => null);
    await approveApplication(db, owner.id, applicationId);
  } catch (err) {
    if (err instanceof ValidationError) return err.message;
    if (err instanceof IllegalTransitionError) return "It can't be approved from where it is now.";
    throw err;
  }
  refresh();
  return null;
}

/** Skips an application from its To do row, without a reason; returns an error message or null. */
export async function quickSkipAction(applicationId: string): Promise<string | null> {
  const { db, owner } = await ownerContext();
  try {
    await skipApplication(db, owner.id, applicationId, { reason: "", lesson: "", lessonScope: "scoring" });
  } catch (err) {
    if (err instanceof ValidationError) return err.message;
    if (err instanceof IllegalTransitionError) return "It can't be skipped from where it is now.";
    throw err;
  }
  refresh();
  return null;
}
