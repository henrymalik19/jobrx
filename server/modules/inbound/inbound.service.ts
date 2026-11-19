// Forwarded mail. Each person gets a private address on Jobrx's receiving domain (u-<random>@in.jobrx.ai) and
// forwards their application email to it: everything, from a mailbox kept for job hunting, or with a filter on a
// plus address (you+jobs@gmail.com). Resend receives the mail and calls /api/inbound/resend, which keeps it in
// inbound_emails; email tracking and the apply runner's security codes read it from there. Jobrx never signs in
// to anyone's mailbox, and never moves, deletes or sends anything from it.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Db, Json } from "@/server/db/types";
import { check, unwrap, ValidationError } from "@/server/core/errors";
import type { AppMailer } from "@/server/integrations/email/app-mail";
import type { InboxMail } from "@/server/integrations/email/inbox";
import { paragraph, renderEmail } from "@/server/integrations/email/layout";
import { NOTIFY_HEADER } from "@/server/modules/notifications/digest";

/** Jobrx's receiving domain (its MX points at Resend). */
export const INBOUND_DOMAIN = "in.jobrx.ai";
/** Forwarded mail is kept this many days (tracking keeps what it needs in `emails`). */
export const KEEP_DAYS = 30;
/** The subject of the test Jobrx sends to check forwarding. */
export const TEST_SUBJECT = "Jobrx forwarding test";
/** The marker header's value on that test (tracking skips mail with the marker header). */
const TEST_MARK = "forwarding-test";

/** A person's forwarding address, made the first time it's asked for (`admin`: the service-role client). */
export async function forwardingAddress(admin: Db, userId: string, domain = INBOUND_DOMAIN): Promise<string> {
  const existing = unwrap(await admin.from("inbound_addresses").select("local_part").eq("user_id", userId).limit(1), "get forwarding address")[0];
  if (existing) return `${existing.local_part}@${domain}`;
  // 10 characters of a-z0-9: unguessable enough that nobody else's mail lands on it by chance.
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const local = `u-${[...randomBytes(10)].map((b) => alphabet[b % alphabet.length]).join("")}`;
  const { error } = await admin.from("inbound_addresses").insert({ user_id: userId, local_part: local });
  // Two at once: the other one won.
  if (error?.code === "23505") return forwardingAddress(admin, userId, domain);
  check({ error }, "save forwarding address");
  return `${local}@${domain}`;
}

// ---- Resend's webhook ----

/**
 * Checks a webhook's signature (Resend signs with Svix): an HMAC-SHA256, keyed with the secret's bytes after
 * "whsec_", of "<svix-id>.<svix-timestamp>.<body>", sent base64 as "v1,<signature>" (several may be sent,
 * space-separated). Older than five minutes, or from the future, is refused.
 */
export function verifyWebhookSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  now = new Date(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** The parts of Resend's `email.received` event Jobrx uses. */
export const receivedEvent = z.object({
  type: z.string(),
  data: z.object({
    email_id: z.string().min(1),
    to: z.array(z.string()).default([]),
    cc: z.array(z.string()).default([]),
    received_for: z.array(z.string()).default([]),
  }).passthrough(),
}).passthrough();

/** A received email's content, from Resend's API (GET /emails/receiving/{id}). */
export type ReceivedEmail = {
  id: string;
  from: string;
  subject: string;
  text: string | null;
  html: string | null;
  headers: Record<string, string>;
  message_id: string;
  created_at: string;
};

/** Fetches a received email's content from Resend. */
export async function fetchReceivedEmail(apiKey: string, id: string, fetchImpl: typeof fetch = fetch): Promise<ReceivedEmail> {
  const res = await fetchImpl(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<ReceivedEmail> & { message?: string };
  if (!res.ok || !body.id) throw new Error(`Resend ${res.status}: ${body.message ?? "no email"}`);
  return {
    id: body.id,
    from: body.from ?? "",
    subject: body.subject ?? "",
    text: body.text ?? null,
    html: body.html ?? null,
    headers: Object.fromEntries(Object.entries(body.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])),
    message_id: body.message_id ?? "",
    created_at: body.created_at ?? new Date().toISOString(),
  };
}

/** The local part of each address on the receiving domain (lower case), from "Name <x@y>" or "x@y". */
function ourAddresses(addresses: string[], domain: string): string[] {
  const out = new Set<string>();
  for (const a of addresses) {
    const m = /<?([^<>\s@]+)@([^<>\s]+?)>?$/.exec(a.trim());
    if (m && m[2].toLowerCase() === domain) out.add(m[1].toLowerCase());
  }
  return [...out];
}

/** "Name <a@b>" → name and address. */
function splitFrom(from: string): { name: string; address: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1].trim(), address: m[2].trim() } : { name: "", address: from.trim() };
}

/** An HTML body as plain text, roughly (for mail without a text part). */
function htmlText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Keeps a received email for each person it was forwarded to. Mail for nobody's address is dropped, and a
 * delivery seen before is kept once.
 *
 * @returns How many people it was kept for.
 */
export async function receiveEmail(
  admin: Db,
  event: z.input<typeof receivedEvent>,
  fetchEmail: (id: string) => Promise<ReceivedEmail>,
  domain = INBOUND_DOMAIN,
): Promise<number> {
  const parsed = receivedEvent.parse(event);
  if (parsed.type !== "email.received") return 0;
  const { data } = parsed;
  const locals = ourAddresses([...data.to, ...data.cc, ...data.received_for], domain);
  if (locals.length === 0) return 0;
  const owners = unwrap(await admin.from("inbound_addresses").select("user_id").in("local_part", locals), "find forwarding addresses");
  if (owners.length === 0) return 0;

  const mail = await fetchEmail(data.email_id);
  const from = splitFrom(mail.headers.from ?? mail.from);
  const text = (mail.text ?? "").trim() || (mail.html ? htmlText(mail.html) : "");
  const rows = owners.map((o) => ({
    user_id: o.user_id,
    provider_id: mail.id,
    message_id: mail.message_id || `${mail.id}@resend`,
    received_at: mail.created_at,
    from_address: from.address,
    from_name: from.name,
    subject: mail.subject.slice(0, 1000),
    // Long enough for any receipt, rejection or code; a huge newsletter is cut.
    text: text.slice(0, 50_000),
    headers: mail.headers as NonNullable<Json>,
  }));
  check(await admin.from("inbound_emails").upsert(rows, { onConflict: "user_id,provider_id", ignoreDuplicates: true }), "keep forwarded mail");
  return rows.length;
}

// ---- Reading it ----

type Row = { message_id: string; received_at: string; from_address: string; from_name: string; subject: string; text: string; headers: Json };

const toMail = (r: Row): InboxMail => ({
  messageId: r.message_id,
  receivedAt: new Date(r.received_at),
  fromAddress: r.from_address,
  fromName: r.from_name,
  subject: r.subject,
  text: r.text,
  headers: (r.headers ?? {}) as Record<string, string>,
});

/**
 * A person's forwarded mail received since `since`, oldest first, optionally only from senders containing
 * `from`, at most `limit` (the newest). Works with the service client or the person's own.
 */
export async function readForwarded(db: Db, userId: string, since: Date, opts: { from?: string; limit?: number } = {}): Promise<InboxMail[]> {
  let q = db.from("inbound_emails").select("message_id, received_at, from_address, from_name, subject, text, headers")
    .eq("user_id", userId).gte("received_at", since.toISOString());
  if (opts.from) q = q.ilike("from_address", `%${opts.from.replace(/[%_]/g, "")}%`);
  const rows = unwrap(await q.order("received_at", { ascending: false }).limit(opts.limit ?? 500), "read forwarded mail") as Row[];
  return rows.reverse().map(toMail);
}

/** Forgets forwarded mail older than {@link KEEP_DAYS} days. @returns How many. */
export async function forgetForwarded(db: Db, userId: string, now: Date): Promise<number> {
  const old = unwrap(
    await db.from("inbound_emails").delete().eq("user_id", userId).lt("received_at", new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString()).select("id"),
    "forget forwarded mail",
  );
  return old.length;
}

// ---- Setting it up ----

/** Gmail's request to confirm forwarding, from the mail it sends to the forwarding address. */
export type GmailConfirmation = { from: string; link: string | null; code: string | null; receivedAt: string };

/** Pulls the confirmation link and code out of Gmail's "Forwarding Confirmation" email. */
export function gmailConfirmation(mail: Pick<InboxMail, "subject" | "text" | "receivedAt">): GmailConfirmation | null {
  if (!/forwarding confirmation/i.test(mail.subject)) return null;
  const link = /https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s<>"')]+/.exec(mail.text)?.[0] ?? null;
  const code = /\(#(\d{6,12})\)/.exec(mail.subject)?.[1] ?? /confirmation code:?\s*(\d{6,12})/i.exec(mail.text)?.[1] ?? null;
  const from = /receive mail from\s+(\S+@\S+)/i.exec(mail.subject)?.[1] ?? /(\S+@\S+) has requested/i.exec(mail.text)?.[1] ?? "";
  return { from: from.replace(/[.,;)]+$/, ""), link, code, receivedAt: mail.receivedAt.toISOString() };
}

/** Where someone's forwarding stands, for the setup card. */
export type ForwardingStatus = {
  address: string;
  /** When the last forwarded email arrived. */
  lastReceivedAt: string | null;
  /** When Jobrx's test came back through forwarding (the newest), and when the newest test went out. */
  testArrivedAt: string | null;
  /** A Gmail confirmation waiting to be opened (the newest, from the last week). */
  gmail: GmailConfirmation | null;
};

/** Where a person's forwarding stands (`admin`: the service-role client). */
export async function forwardingStatus(admin: Db, userId: string, now = new Date()): Promise<ForwardingStatus> {
  const address = await forwardingAddress(admin, userId);
  const week = new Date(now.getTime() - 7 * 86_400_000);
  const [last, test, gmail] = await Promise.all([
    admin.from("inbound_emails").select("received_at").eq("user_id", userId).order("received_at", { ascending: false }).limit(1),
    admin.from("inbound_emails").select("received_at").eq("user_id", userId).ilike("subject", `%${TEST_SUBJECT}%`).order("received_at", { ascending: false }).limit(1),
    admin.from("inbound_emails").select("message_id, received_at, from_address, from_name, subject, text, headers").eq("user_id", userId)
      .ilike("from_address", "%forwarding-noreply@google.com").gte("received_at", week.toISOString()).order("received_at", { ascending: false }).limit(1),
  ]);
  const confirm = (unwrap(gmail, "gmail confirmation") as Row[])[0];
  const testAt = unwrap(test, "forwarding test")[0]?.received_at ?? null;
  const confirmation = confirm ? gmailConfirmation(toMail(confirm)) : null;
  return {
    address,
    lastReceivedAt: unwrap(last, "last forwarded mail")[0]?.received_at ?? null,
    testArrivedAt: testAt,
    // Once forwarding works, the confirmation is done with.
    gmail: confirmation && (!testAt || testAt < confirmation.receivedAt) ? confirmation : null,
  };
}

/** True when a forwarded email is Jobrx's own (the digest, a verification link, the forwarding test). */
export const isOwnMail = (mail: Pick<InboxMail, "headers" | "subject">) =>
  !!mail.headers[NOTIFY_HEADER.toLowerCase()] || mail.subject.includes(TEST_SUBJECT);

/**
 * Sends the forwarding test to the verified application email: when forwarding works, it comes back to the
 * forwarding address within a minute and the setup card says so.
 *
 * @throws {@link ValidationError} without a verified application email, or when nothing can send.
 */
export async function sendForwardingTest(admin: Db, userId: string, mailer: AppMailer | null): Promise<string> {
  const row = unwrap(await admin.from("profiles").select("email, email_verified_at").eq("user_id", userId).limit(1), "get application email")[0];
  if (!row?.email) throw new ValidationError("Add your application email on Profile first.");
  if (!row.email_verified_at) throw new ValidationError("Verify your application email on Profile first.");
  if (!mailer) throw new ValidationError("Jobrx can't send email here yet (no RESEND_API_KEY).");
  const address = await forwardingAddress(admin, userId);
  const body = `If forwarding is set up, this email reaches Jobrx at ${address} within a minute, and Settings says it worked. You can delete it.`;
  await mailer.send({
    from: mailer.from,
    to: row.email,
    subject: `${TEST_SUBJECT} (${new Date().toISOString().slice(11, 16)} UTC)`,
    text: `${body}\n`,
    html: renderEmail({ title: TEST_SUBJECT, preview: "Checking that your application email forwards to Jobrx.", heading: "Forwarding test", body: paragraph(body, { last: true }) }),
    headers: { [NOTIFY_HEADER]: TEST_MARK },
  });
  return row.email;
}
