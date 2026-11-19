// The application email against the local Supabase stack: verified when it's the sign-in address, unverified
// when changed, never marked verified by the member themselves, and verified by the emailed link (once, and
// only for the address it was sent to). Links go into Mailpit, the local stack's mailbox.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Db } from "@/server/db/types";
import { ValidationError } from "@/server/core/errors";
import { appMailer } from "@/server/integrations/email/app-mail";
import { getApplicationEmail, sendEmailVerification, verifyApplicationEmail } from "@/server/modules/profile/application-email";
import type {} from "./setup";

const { url: URL, anonKey: ANON, serviceRoleKey: SERVICE } = inject("supabase");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts) as unknown as Db;
const mailer = appMailer({ SUPABASE_URL: URL })!;
const appUrl = "http://localhost:3000";

const tag = randomUUID().slice(0, 8);
const signIn = `sign-in-${tag}@example.test`;
const other = `apply-${tag}@example.test`;
let userId = "";
let member: Db;

/** The newest link Mailpit caught for an address. */
async function linkFor(to: string): Promise<string> {
  const mailpit = URL.replace(":54321", ":54324");
  for (let i = 0; i < 20; i++) {
    const found = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`).then((r) => r.json());
    const id = found.messages?.[0]?.ID;
    if (id) {
      const html: string = (await fetch(`${mailpit}/api/v1/message/${id}`).then((r) => r.json())).HTML;
      return html.match(/href="([^"]*\/verify-email\?token=[^"]+)"/)![1].replaceAll("&amp;", "&");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email to ${to}`);
}
const tokenOf = (link: string) => new globalThis.URL(link).searchParams.get("token")!;

async function profile() {
  const { data } = await admin.from("profiles").select("email, email_verified_at").eq("user_id", userId).single();
  return data!;
}

beforeAll(async () => {
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email: signIn, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await admin.from("users").insert({ id: userId, role: "member" });
  const client = createClient(URL, ANON, opts);
  const signedIn = await client.auth.signInWithPassword({ email: signIn, password });
  if (signedIn.error) throw signedIn.error;
  member = client as unknown as Db;
});

afterAll(async () => {
  await admin.from("users").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
});

describe("application email", () => {
  it("is verified when it's the address you sign in with", async () => {
    await member.from("profiles").upsert({ user_id: userId, email: signIn.toUpperCase() });
    expect((await profile()).email_verified_at).not.toBeNull();
  });

  it("is unverified once changed, and a member can't mark it verified", async () => {
    await member.from("profiles").update({ email: other }).eq("user_id", userId);
    expect((await profile()).email_verified_at).toBeNull();
    await member.from("profiles").update({ email_verified_at: new Date().toISOString() }).eq("user_id", userId);
    expect((await profile()).email_verified_at).toBeNull();
    expect(await getApplicationEmail(admin, userId)).toEqual({ email: other, verified: false, linkSentAt: null });
  });

  it("keeps links to itself: a member can't read them", async () => {
    const { data, error } = await member.from("email_verifications").select("id");
    expect(error ?? data).toBeTruthy();
    expect(data ?? []).toEqual([]);
  });

  it("emails a link that verifies it, once a minute at most", async () => {
    await sendEmailVerification(admin, userId, { mailer, appUrl });
    await expect(sendEmailVerification(admin, userId, { mailer, appUrl })).rejects.toThrow("A link just went out");
    expect((await getApplicationEmail(admin, userId)).linkSentAt).not.toBeNull();

    const link = await linkFor(other);
    expect(link.startsWith(`${appUrl}/verify-email?token=`)).toBe(true);
    expect(await verifyApplicationEmail(admin, tokenOf(link))).toEqual({ result: "verified", userId });
    expect((await profile()).email_verified_at).not.toBeNull();
    // Opened again (a mail scanner may get there first): still verified.
    expect((await verifyApplicationEmail(admin, tokenOf(link))).result).toBe("verified");
    await expect(sendEmailVerification(admin, userId, { mailer, appUrl })).rejects.toThrow("already verified");
  });

  it("doesn't verify a new address with a link for the old one, or a made-up or expired link", async () => {
    const newer = `newer-${tag}@example.test`;
    await member.from("profiles").update({ email: newer }).eq("user_id", userId);
    const old = await linkFor(other);
    expect((await verifyApplicationEmail(admin, tokenOf(old))).result).toBe("changed");
    expect((await verifyApplicationEmail(admin, "x".repeat(43))).result).toBe("invalid");
    expect((await verifyApplicationEmail(admin, "bad token!")).result).toBe("invalid");

    const later = new Date(Date.now() + 2 * 60_000);
    await sendEmailVerification(admin, userId, { mailer, appUrl, now: later });
    const link = await linkFor(newer);
    expect((await verifyApplicationEmail(admin, tokenOf(link), new Date(later.getTime() + 25 * 3_600_000))).result).toBe("expired");
    expect((await profile()).email_verified_at).toBeNull();
  });

  it("asks for an email first, and says so when nothing can send", async () => {
    await member.from("profiles").update({ email: null }).eq("user_id", userId);
    await expect(sendEmailVerification(admin, userId, { mailer, appUrl })).rejects.toThrow("Add your application email");
    await member.from("profiles").update({ email: other }).eq("user_id", userId);
    await expect(sendEmailVerification(admin, userId, { mailer: null, appUrl })).rejects.toThrow(ValidationError);
  });
});
