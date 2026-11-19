// The application email: the address on your profile, which goes on every application Jobrx fills in. It can
// differ from the one you sign in with, and is used only once verified: it's your sign-in address, or you
// opened the link Jobrx emailed to it. The database keeps that honest (a changed email is unverified again,
// and only the server can mark one verified); see supabase/migrations/20261209000000_application_email.sql.
//
// Sending and checking links uses the service-role client: the links live in a table only the server reads.
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "@/server/db/types";
import { check, unwrap, ValidationError } from "@/server/core/errors";
import type { AppMailer } from "@/server/integrations/email/app-mail";
import { escapeHtml, paragraph, renderEmail } from "@/server/integrations/email/layout";
import { NOTIFY_HEADER } from "@/server/modules/notifications/digest";

/** How long a link works. */
export const VERIFY_HOURS = 24;
/** A new link can be sent this long after the last. */
export const RESEND_AFTER_SECONDS = 60;
/** At most this many links a day. */
export const LINKS_PER_DAY = 5;

/** Where someone's application email stands. */
export type ApplicationEmail = {
  email: string | null;
  verified: boolean;
  /** When the last link went out for this address, if one is waiting. */
  linkSentAt: string | null;
};

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

async function profileEmail(db: Db, userId: string): Promise<{ email: string | null; verifiedAt: string | null }> {
  const row = unwrap(await db.from("profiles").select("email, email_verified_at").eq("user_id", userId).limit(1), "get application email")[0];
  return { email: row?.email ?? null, verifiedAt: row?.email_verified_at ?? null };
}

/** Where a user's application email stands (`admin` is the service-role client, which reads the links). */
export async function getApplicationEmail(admin: Db, userId: string, now = new Date()): Promise<ApplicationEmail> {
  const { email, verifiedAt } = await profileEmail(admin, userId);
  if (!email || verifiedAt) return { email, verified: !!verifiedAt, linkSentAt: null };
  const link = unwrap(
    await admin.from("email_verifications").select("email, created_at").eq("user_id", userId).is("used_at", null)
      .gt("expires_at", now.toISOString()).order("created_at", { ascending: false }).limit(1),
    "last verification link",
  )[0];
  return { email, verified: false, linkSentAt: link && same(link.email, email) ? link.created_at : null };
}

/** The verification email for one address. */
export function verificationEmail(email: string, link: string): { subject: string; text: string; html: string } {
  const subject = "Verify your application email";
  const intro = `Jobrx puts ${email} on the job applications it fills in for you, and that's where employers will reply. Confirm it's yours:`;
  const after = `The link works for ${VERIFY_HOURS} hours. If you didn't ask for this, ignore this email: nothing changes.`;
  const html = renderEmail({
    title: subject,
    preview: `Confirm ${email} for your Jobrx applications.`,
    heading: "Verify your application email",
    body: paragraph(intro, { last: true }) + `<div style="height:20px;line-height:20px">&nbsp;</div>`,
    button: { label: "Verify this email", href: link },
    footnote: `${escapeHtml(after)}<br><br><span style="word-break:break-all">Button not working? Paste this into your browser: ${escapeHtml(link)}</span>`,
  });
  return { subject, html, text: `${intro}\n\n${link}\n\n${after}\n` };
}

/**
 * Emails a link to verify the user's application email.
 *
 * @throws {@link ValidationError} when there's no email, it's already verified, a link just went out, or too
 * many went out today.
 */
export async function sendEmailVerification(
  admin: Db,
  userId: string,
  deps: { mailer: AppMailer | null; appUrl: string; now?: Date },
): Promise<void> {
  const now = deps.now ?? new Date();
  const { email, verifiedAt } = await profileEmail(admin, userId);
  if (!email) throw new ValidationError("Add your application email to your profile first.");
  if (verifiedAt) throw new ValidationError(`${email} is already verified.`);
  if (!deps.mailer) throw new ValidationError("Jobrx can't send email here yet (no RESEND_API_KEY).");

  const recent = unwrap(
    await admin.from("email_verifications").select("created_at").eq("user_id", userId)
      .gt("created_at", new Date(now.getTime() - 86_400_000).toISOString()).order("created_at", { ascending: false }),
    "recent verification links",
  );
  if (recent[0] && now.getTime() - new Date(recent[0].created_at).getTime() < RESEND_AFTER_SECONDS * 1000) {
    throw new ValidationError("A link just went out. Give it a minute, and check your spam folder.");
  }
  if (recent.length >= LINKS_PER_DAY) throw new ValidationError("That's enough links for today. Try again tomorrow.");

  const token = randomBytes(32).toString("base64url");
  check(
    await admin.from("email_verifications").insert({
      user_id: userId, email, token_hash: hash(token), expires_at: new Date(now.getTime() + VERIFY_HOURS * 3_600_000).toISOString(),
    }),
    "save verification link",
  );
  const link = `${deps.appUrl.replace(/\/$/, "")}/verify-email?token=${token}`;
  await deps.mailer.send({ from: deps.mailer.from, to: email, ...verificationEmail(email, link), headers: { [NOTIFY_HEADER]: "verify-email" } });
}

/** What opening a link did. */
export type VerifyResult = "verified" | "expired" | "changed" | "invalid";

/**
 * Checks a link's token and marks the application email verified. Opening a link again (a mail scanner may
 * open it first) still says verified, while the email is the same.
 */
export async function verifyApplicationEmail(admin: Db, token: string, now = new Date()): Promise<{ result: VerifyResult; userId?: string }> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { result: "invalid" };
  const link = unwrap(
    await admin.from("email_verifications").select("id, user_id, email, expires_at, used_at").eq("token_hash", hash(token)).limit(1),
    "find verification link",
  )[0];
  if (!link) return { result: "invalid" };
  const userId = link.user_id;
  const { email, verifiedAt } = await profileEmail(admin, userId);
  if (!same(email, link.email)) return { result: "changed", userId };
  if (verifiedAt) return { result: "verified", userId };
  if (link.used_at || new Date(link.expires_at) <= now) return { result: "expired", userId };

  check(await admin.from("profiles").update({ email_verified_at: now.toISOString() }).eq("user_id", link.user_id).eq("email", link.email), "verify email");
  check(await admin.from("email_verifications").update({ used_at: now.toISOString() }).eq("id", link.id), "use verification link");
  return { result: "verified", userId };
}
