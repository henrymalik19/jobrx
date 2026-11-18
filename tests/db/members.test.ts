// Members: requests to join, invites, removing and restoring access, and what a member can't do (raise their
// own Claude cap, have the owner's job inbox read for them). Against the local Supabase stack.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Db } from "@/server/db/types";
import { ValidationError } from "@/server/core/errors";
import {
  declineAccessRequest,
  inviteMember,
  listAccessRequests,
  listAccounts,
  removeAccess,
  requestAccess,
  restoreAccess,
} from "@/server/modules/members/members.service";
import { listUsers } from "@/server/modules/users/users.service";
import { trackEmail } from "@/workers/stages";
import { testUser } from "./users";
import type {} from "./setup";

const { url: URL, anonKey: ANON, serviceRoleKey: SERVICE } = inject("supabase");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(URL, SERVICE, opts) as unknown as Db;

const emails: string[] = [];
const authIds: string[] = [];
let owner: { id: string; cleanup: () => Promise<void> };

/** A fresh address for one test (its requests, account and mail are removed afterwards). */
function address() {
  const e = `member-${randomUUID().slice(0, 8)}@example.test`;
  emails.push(e);
  return e;
}

/** A member with a password, signed in (as an invited member who finished joining would be). */
async function joinedMember() {
  const email = address();
  const id = await inviteMember(db, email);
  authIds.push(id);
  const password = randomUUID();
  const { error } = await db.auth.admin.updateUserById(id, { password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id, email, password, client: client as unknown as Db };
}

/** The invite email Mailpit (the local stack's mailbox) caught for an address, as HTML. */
async function inviteMail(to: string): Promise<string | null> {
  const mailpit = URL.replace(":54321", ":54324");
  for (let i = 0; i < 20; i++) {
    const search = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`).then((r) => r.json());
    const id = search.messages?.[0]?.ID;
    if (id) return (await fetch(`${mailpit}/api/v1/message/${id}`).then((r) => r.json())).HTML;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

beforeAll(async () => {
  owner = await testUser(db);
});

afterAll(async () => {
  await db.from("access_requests").delete().in("email", emails);
  await db.from("notifications").delete().eq("user_id", owner.id).in("dedupe_key", emails.map((e) => `access_request:${e}`));
  await db.from("users").delete().in("id", authIds);
  for (const id of authIds) await db.auth.admin.deleteUser(id);
  await owner.cleanup();
});

describe("requests to join", () => {
  it("saves a request once while it waits, and tells the owner", async () => {
    const email = address();
    await requestAccess(db, { name: "Ada Lovelace", email: email.toUpperCase(), note: "Backend roles" });
    await requestAccess(db, { name: "Ada again", email, note: "" });
    const mine = (await listAccessRequests(db)).filter((r) => r.email === email);
    expect(mine).toEqual([expect.objectContaining({ name: "Ada Lovelace", email, note: "Backend roles" })]);
    const { data: told } = await db.from("notifications").select("kind, title, href").eq("user_id", owner.id).eq("dedupe_key", `access_request:${email}`);
    expect(told).toEqual([{ kind: "access_request", title: "Ada Lovelace asked to join", href: "/admin/users" }]);
  });

  it("rejects a bad email or a missing name", async () => {
    await expect(requestAccess(db, { name: "X", email: "not-an-email" })).rejects.toThrow(ValidationError);
    await expect(requestAccess(db, { name: " ", email: address() })).rejects.toThrow("Enter your name.");
  });

  it("drops a declined request from the list", async () => {
    const email = address();
    await requestAccess(db, { name: "Grace", email });
    const request = (await listAccessRequests(db)).find((r) => r.email === email)!;
    await declineAccessRequest(db, request.id);
    expect((await listAccessRequests(db)).some((r) => r.email === email)).toBe(false);
  });
});

describe("invites", () => {
  it("makes a member following the owner's boards, marks their request invited, and emails the link", async () => {
    const email = address();
    await requestAccess(db, { name: "Alan", email });
    const id = await inviteMember(db, email);
    authIds.push(id);

    const { data: user } = await db.from("users").select("role, removed_at").eq("id", id).single();
    expect(user).toEqual({ role: "member", removed_at: null });
    const follows = async (userId: string) =>
      ((await db.from("user_companies").select("company_id").eq("user_id", userId)).data ?? []).map((r) => r.company_id).sort();
    expect(await follows(id)).toEqual(await follows(owner.id));
    expect((await listAccessRequests(db)).some((r) => r.email === email)).toBe(false);
    expect((await listAccounts(db)).get(id)).toEqual(expect.objectContaining({ email, status: "invited" }));

    const html = await inviteMail(email);
    expect(html).toContain("You're invited to Jobrx");
    expect(html).toMatch(/\/auth\/confirm\?token_hash=\w+&amp;type=invite&amp;next=\/login\/welcome/);
  });

  it("sends a fresh link to someone who hasn't joined, but not to a member", async () => {
    const email = address();
    const id = await inviteMember(db, email);
    authIds.push(id);
    expect(await inviteMember(db, email.toUpperCase())).toBe(id);

    const joined = await joinedMember();
    await expect(inviteMember(db, joined.email)).rejects.toThrow("already has access");
  });
});

describe("removing access", () => {
  it("signs a member out of everything until restored, keeping their data", async () => {
    const m = await joinedMember();
    await m.client.from("lessons").insert({ rule: "Keep me", scope: "global" });

    await removeAccess(db, m.id);
    expect((await m.client.rpc("is_member")).data).toBe(false);
    expect((await m.client.from("lessons").select("rule")).data).toEqual([]);
    const again = createClient(URL, ANON, opts);
    expect((await again.auth.signInWithPassword({ email: m.email, password: m.password })).error).not.toBeNull();
    expect((await listUsers(db)).some((u) => u.id === m.id)).toBe(false);
    expect((await listAccounts(db)).get(m.id)?.status).toBe("removed");
    await expect(inviteMember(db, m.email)).rejects.toThrow("Restore their access instead");

    await restoreAccess(db, m.id);
    const back = createClient(URL, ANON, opts);
    expect((await back.auth.signInWithPassword({ email: m.email, password: m.password })).error).toBeNull();
    expect((await back.from("lessons").select("rule")).data).toEqual([{ rule: "Keep me" }]);
    expect((await listUsers(db)).some((u) => u.id === m.id)).toBe(true);
  });

  it("never removes the owner", async () => {
    await expect(removeAccess(db, owner.id)).rejects.toThrow("can't be removed");
  });
});

describe("what a member can't do", () => {
  it("can't set their own Claude cap, but can change their other settings", async () => {
    const m = await joinedMember();
    const cap = await m.client.from("user_settings").upsert({ key: "llm_monthly_cap_usd", value: 500 });
    expect(cap.error).not.toBeNull();
    const daily = await m.client.from("user_settings").upsert({ key: "daily_cap", value: 3 });
    expect(daily.error).toBeNull();

    await db.from("user_settings").upsert({ user_id: m.id, key: "llm_monthly_cap_usd", value: 10 });
    expect((await m.client.from("user_settings").update({ value: 500 }).eq("key", "llm_monthly_cap_usd").select()).data).toEqual([]);
    expect((await m.client.from("user_settings").select("value").eq("key", "llm_monthly_cap_usd").single()).data?.value).toBe(10);
  });

  it("doesn't get the owner's job inbox read for them", async () => {
    const m = await joinedMember();
    await db.from("user_settings").upsert({ user_id: m.id, key: "job_inbox", value: { address: "owner@example.test" } });
    const out = await trackEmail.run(db, m.id, { id: m.id, role: "member" });
    expect(out.counts).toEqual({ skipped: "no inbox password of their own yet" });
  });
});
