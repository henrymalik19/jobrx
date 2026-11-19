// Forwarded mail against the local Supabase stack: each person's private address, Resend's received mail kept for
// whoever it was forwarded to (once), read back by tracking and by the person (not anyone else), Gmail's
// confirmation surfaced, the forwarding test, and old mail forgotten.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Db } from "@/server/db/types";
import { appMailer } from "@/server/integrations/email/app-mail";
import {
  forgetForwarded, forwardingAddress, forwardingStatus, INBOUND_DOMAIN, readForwarded, receiveEmail, sendForwardingTest, TEST_SUBJECT, type ReceivedEmail,
} from "@/server/modules/inbound/inbound.service";
import type {} from "./setup";

const { url: URL, anonKey: ANON, serviceRoleKey: SERVICE } = inject("supabase");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts) as unknown as Db;
const tag = randomUUID().slice(0, 8);

type Person = { id: string; email: string; client: Db };
const people: Person[] = [];

async function person(name: string): Promise<Person> {
  const email = `${name}-${tag}@example.test`;
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  await admin.from("users").insert({ id: data.user.id, role: "member" });
  const client = createClient(URL, ANON, opts);
  await client.auth.signInWithPassword({ email, password });
  const p = { id: data.user.id, email, client: client as unknown as Db };
  people.push(p);
  return p;
}

/** A received email as Resend's API returns it. */
const received = (id: string, over: Partial<ReceivedEmail> = {}): ReceivedEmail => ({
  id, from: "no-reply@us.greenhouse-mail.io", subject: "Thank you for applying", text: "We received your application.", html: null,
  headers: { from: "Acme Recruiting <no-reply@us.greenhouse-mail.io>" }, message_id: `<${id}@mail.test>`, created_at: new Date().toISOString(), ...over,
});

let ada: Person;
let bob: Person;
let adaAddress = "";

beforeAll(async () => {
  ada = await person("ada");
  bob = await person("bob");
  adaAddress = await forwardingAddress(admin, ada.id);
});

afterAll(async () => {
  for (const p of people) {
    await admin.from("users").delete().eq("id", p.id);
    await admin.auth.admin.deleteUser(p.id);
  }
});

describe("forwarding address", () => {
  it("is one private address per person, on the receiving domain", async () => {
    expect(adaAddress).toMatch(new RegExp(`^u-[a-z0-9]{10}@${INBOUND_DOMAIN.replace(".", "\\.")}$`));
    expect(await forwardingAddress(admin, ada.id)).toBe(adaAddress);
    expect(await forwardingAddress(admin, bob.id)).not.toBe(adaAddress);
  });

  it("is readable by its owner only, and nobody but the server makes one", async () => {
    expect((await ada.client.from("inbound_addresses").select("user_id")).data).toEqual([{ user_id: ada.id }]);
    const { error } = await bob.client.from("inbound_addresses").insert({ user_id: bob.id, local_part: "u-mine12345" });
    expect(error).not.toBeNull();
  });
});

describe("receiving", () => {
  const event = (id: string, to: string[]) => ({ type: "email.received", data: { email_id: id, to, cc: [], received_for: [] } });

  it("keeps mail forwarded to someone's address for them, once", async () => {
    const fetched: string[] = [];
    const fetchEmail = async (id: string) => (fetched.push(id), received(id));
    const id = `rx-${tag}-1`;
    expect(await receiveEmail(admin, event(id, [`Ada <${adaAddress.toUpperCase()}>`]), fetchEmail)).toBe(1);
    expect(await receiveEmail(admin, event(id, [adaAddress]), fetchEmail)).toBe(1);
    const { data } = await admin.from("inbound_emails").select("from_address, from_name, subject, text").eq("user_id", ada.id);
    expect(data).toEqual([{ from_address: "no-reply@us.greenhouse-mail.io", from_name: "Acme Recruiting", subject: "Thank you for applying", text: "We received your application." }]);
  });

  it("drops mail for nobody's address without fetching it, and ignores other events", async () => {
    const fetchEmail = async () => { throw new Error("fetched"); };
    expect(await receiveEmail(admin, event(`rx-${tag}-2`, [`u-nobody00000@${INBOUND_DOMAIN}`, "someone@else.test"]), fetchEmail)).toBe(0);
    expect(await receiveEmail(admin, { type: "email.sent", data: { email_id: "x", to: [adaAddress] } }, fetchEmail)).toBe(0);
  });

  it("reads an HTML-only email as text", async () => {
    const id = `rx-${tag}-3`;
    await receiveEmail(admin, event(id, [adaAddress]), async () => received(id, { text: null, html: "<p>Hi Ada,</p><p>Your code is <b>aB3dE9fG</b>&nbsp;today.</p><style>p{}</style>" }));
    const mail = (await readForwarded(admin, ada.id, new Date(Date.now() - 60_000), { from: "greenhouse" })).find((m) => m.messageId === `<${id}@mail.test>`);
    expect(mail?.text).toBe("Hi Ada,\nYour code is aB3dE9fG today.");
  });

  it("lets each person read only their own (the apply runner reads codes as them)", async () => {
    expect((await ada.client.from("inbound_emails").select("id")).data!.length).toBeGreaterThan(0);
    expect((await bob.client.from("inbound_emails").select("id")).data).toEqual([]);
    expect((await readForwarded(ada.client, ada.id, new Date(Date.now() - 60_000))).length).toBeGreaterThan(0);
    const { error } = await bob.client.from("inbound_emails").insert({ user_id: bob.id, provider_id: "x", message_id: "x", received_at: new Date().toISOString() });
    expect(error).not.toBeNull();
  });
});

describe("setting it up", () => {
  it("shows Gmail's confirmation until forwarding works", async () => {
    const id = `rx-${tag}-g`;
    await receiveEmail(admin, { type: "email.received", data: { email_id: id, to: [adaAddress] } }, async () => received(id, {
      from: "forwarding-noreply@google.com",
      headers: { from: "Gmail Team <forwarding-noreply@google.com>" },
      subject: `(#987654321) Gmail Forwarding Confirmation - Receive Mail from ${ada.email}`,
      text: `${ada.email} has requested to automatically forward mail to your email address ${adaAddress}.\nConfirmation code: 987654321\n\nhttps://mail-settings.google.com/mail/vf-abc-123\n`,
    }));
    const status = await forwardingStatus(admin, ada.id);
    expect(status).toMatchObject({ address: adaAddress, testArrivedAt: null, gmail: { from: ada.email, code: "987654321", link: "https://mail-settings.google.com/mail/vf-abc-123" } });
    expect(status.lastReceivedAt).not.toBeNull();
  });

  it("sends the test to the verified application email, and says when it came back", async () => {
    await expect(sendForwardingTest(admin, ada.id, appMailer({ SUPABASE_URL: URL }))).rejects.toThrow("application email on Profile first");
    // Ada's application email is the one she signs in with: verified.
    await ada.client.from("profiles").upsert({ user_id: ada.id, email: ada.email });
    expect(await sendForwardingTest(admin, ada.id, appMailer({ SUPABASE_URL: URL }))).toBe(ada.email);

    const id = `rx-${tag}-t`;
    await receiveEmail(admin, { type: "email.received", data: { email_id: id, to: [adaAddress] } }, async () => received(id, { subject: `Fwd: ${TEST_SUBJECT} (12:00 UTC)` }));
    const status = await forwardingStatus(admin, ada.id);
    expect(status.testArrivedAt).not.toBeNull();
    expect(status.gmail).toBeNull();
  });

  it("forgets forwarded mail after 30 days", async () => {
    expect(await forgetForwarded(admin, ada.id, new Date(Date.now() + 31 * 86_400_000))).toBeGreaterThan(0);
    expect((await admin.from("inbound_emails").select("id").eq("user_id", ada.id)).data).toEqual([]);
  });
});
