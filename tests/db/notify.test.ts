// The daily digest (notify) against a local Supabase, with a fake mail sender:
//   - nothing goes out before the digest time; then one digest, of what's waiting, to the job inbox
//   - one a day: not again that day, and not the next day when nothing is new
//   - news since the last digest (an interview invite) comes first, from the worker's address (Resend)
//   - turned off, nothing goes out
//   - someone without a job inbox gets it at the address they sign in with
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Db } from "@/server/db/types";
import type { OutgoingEmail, SmtpConfig } from "@/server/integrations/email/smtp";
import { runNotify, setDigestSettings } from "@/server/modules/notifications/notifications.service";
import { ValidationError } from "@/server/core/errors";
import type {} from "./setup";
import { setUserSettings, testUser } from "./users";

const { url: URL, serviceRoleKey: SERVICE } = inject("supabase");
const db = createClient(URL, SERVICE, { auth: { persistSession: false } }) as unknown as Db;

const tag = randomUUID().slice(0, 8);
let companyId = "";
const jobIds: string[] = [];
const appIds: string[] = [];
const authIds: string[] = [];
let userId = "";
let cleanupUser = async () => {};
let restoreSettings = async () => {};

const sent: { config: SmtpConfig; email: OutgoingEmail }[] = [];
const createSender = (config: SmtpConfig) => async (email: OutgoingEmail) => {
  sent.push({ config, email });
  return `<${randomUUID()}@test>`;
};

/**
 * Runs the digest at `now`. A run that sent is dated `now` (runs are dated by the database's clock), so "already
 * sent today" is judged on the test's days.
 */
async function notify(now: Date, opts: { user?: string; from?: string } = {}) {
  const user = opts.user ?? userId;
  const out = await runNotify({ db, userId: user, password: "test-password", createSender, now, from: opts.from });
  if (out.counts.sent) {
    const { data } = await db.from("worker_runs").select("id").eq("worker", "notify").eq("user_id", user).order("started_at", { ascending: false }).limit(1).single();
    await db.from("worker_runs").update({ started_at: now.toISOString() }).eq("id", data!.id);
  }
  return out;
}

async function addApplication(key: string, status: string, user = userId): Promise<string> {
  const { data: job } = await db
    .from("jobs")
    .insert({ company_id: companyId, company_name: `NotifyCo ${tag}`, source: "greenhouse", external_id: `${tag}:${key}`, url: `https://example.test/${tag}/${key}`, title: `Engineer ${key} ${tag}`, dedup_key: `${tag}-notify-${key}` })
    .select("id")
    .single();
  jobIds.push(job!.id);
  const { data: app, error } = await db.from("applications").insert({ user_id: user, job_id: job!.id, status }).select("id, job_id").single();
  if (error) throw new Error(error.message);
  appIds.push(app!.id);
  return app!.id;
}

/** Marks the user's other applications notified, so only this file's rows are new. */
async function quietOthers() {
  const { data } = await db.from("applications").select("id, status").eq("user_id", userId).not("id", "in", `(${appIds.join(",") || randomUUID()})`);
  for (const row of data ?? []) await db.from("applications").update({ notified_status: row.status }).eq("id", row.id);
}

// 8:05 in New York (EST) on three days in a row.
const day1 = new Date("2030-01-15T13:05:00Z");
const day2 = new Date("2030-01-16T13:05:00Z");
const day3 = new Date("2030-01-17T13:05:00Z");

beforeAll(async () => {
  ({ id: userId, cleanup: cleanupUser } = await testUser(db));
  restoreSettings = await setUserSettings(db, userId, {
    job_inbox: { address: "jobs@example.test", smtp_host: "smtp.example.test", smtp_port: 465 },
    notifications: { to: null, digest: "daily", digest_time: "08:00", timezone: "America/New_York" },
  });
  await db.from("worker_runs").delete().eq("worker", "notify").eq("user_id", userId);
  const { data: company } = await db.from("companies").insert({ name: `NotifyCo ${tag}`, ats: "greenhouse", board_token: `notify${tag}` }).select("id").single();
  companyId = company!.id;

  const appId = await addApplication("blocked", "needs_input");
  await db.from("application_questions").insert({ application_id: appId, question: `Clearance ${tag}?`, field_name: "q1", field_type: "text", required: true, bucket: "needs_user", sort_order: 0 });
  await quietOthers();
});

afterAll(async () => {
  await db.from("applications").delete().in("id", appIds);
  await db.from("jobs").delete().in("id", jobIds);
  await db.from("companies").delete().eq("id", companyId);
  await db.from("worker_runs").delete().eq("worker", "notify").in("user_id", [userId, ...authIds]);
  await db.from("users").delete().in("id", authIds);
  for (const id of authIds) await db.auth.admin.deleteUser(id);
  await restoreSettings();
  await cleanupUser();
});

describe("daily digest", () => {
  it("waits for the digest time", async () => {
    const { counts } = await notify(new Date("2030-01-15T12:30:00Z")); // 7:30
    expect(counts).toMatchObject({ sent: 0, not_yet: 1 });
    expect(sent).toHaveLength(0);
  });

  it("then emails what's waiting, with its question, from and to the job inbox", async () => {
    const { counts } = await notify(day1);
    expect(counts).toMatchObject({ sent: 1, due: 1 });
    expect(sent).toHaveLength(1);
    const { config, email } = sent[0];
    expect(config).toMatchObject({ host: "smtp.example.test", port: 465, user: "jobs@example.test", password: "test-password" });
    expect(email.from).toBe("Jobrx <jobs@example.test>");
    expect(email.to).toBe("jobs@example.test");
    expect(email.subject).toMatch(/^Jobrx: \d+ needs? you/);
    expect(email.text).toContain(`Question: Clearance ${tag}?`);
    expect(email.html).toContain(`/app/applications/${appIds[0]}`);
    expect(email.html).toMatch(/^<!doctype html>/);
    expect(email.headers).toEqual({ "X-Autopilot": "notify" });

    const { data: app } = await db.from("applications").select("notified_status").eq("id", appIds[0]).single();
    expect(app!.notified_status).toBe("needs_input");
  });

  it("sends once a day, and not at all on a day with nothing new", async () => {
    expect((await notify(new Date("2030-01-15T22:00:00Z"))).counts).toMatchObject({ sent: 0, not_yet: 1 });
    expect((await notify(day2)).counts).toMatchObject({ sent: 0, due: 0 });
    expect(sent).toHaveLength(1);
  });

  it("puts news since the last digest first, from the worker's address", async () => {
    const interview = await addApplication("interview", "interviewing");
    const { data: app } = await db.from("applications").select("job_id").eq("id", interview).single();
    await db.from("application_events").insert({ application_id: interview, job_id: app!.job_id, from_status: "responded", to_status: "interviewing", cause: "test", created_at: "2030-01-16T15:00:00Z" });

    const { counts } = await notify(day3, { from: "Jobrx <no-reply@jobrx.test>" });
    expect(counts).toMatchObject({ sent: 1, due: 1 });
    const { email } = sent.at(-1)!;
    expect(email.from).toBe("Jobrx <no-reply@jobrx.test>");
    expect(email.subject).toMatch(/^Jobrx: 1 interview invite, /);
    expect(email.text.indexOf("Interview invites")).toBeLessThan(email.text.indexOf("Questions only you can answer"));
    expect(email.text).toContain(`Engineer interview ${tag}`);
  });

  it("sends nothing when it's turned off", async () => {
    await setDigestSettings(db, userId, { digest: "off", digest_time: "08:00", timezone: "America/New_York" });
    await addApplication("manual", "manual");
    const { counts } = await notify(new Date("2030-01-18T13:05:00Z"));
    expect(counts).toMatchObject({ sent: 0, off: 1 });
    await setDigestSettings(db, userId, { digest: "daily", digest_time: "08:00", timezone: "America/New_York" });
  });

  it("keeps who it's to when the time changes, and rejects a bad time or zone", async () => {
    await setUserSettings(db, userId, { notifications: { to: "me@example.test", digest: "daily", digest_time: "08:00", timezone: "America/New_York" } });
    await setDigestSettings(db, userId, { digest: "daily", digest_time: "06:45", timezone: "Europe/London" });
    const { data } = await db.from("user_settings").select("value").eq("user_id", userId).eq("key", "notifications").single();
    expect(data!.value).toEqual({ to: "me@example.test", digest: "daily", digest_time: "06:45", timezone: "Europe/London" });
    await expect(setDigestSettings(db, userId, { digest: "daily", digest_time: "06:40", timezone: "Europe/London" })).rejects.toThrow(ValidationError);
    await expect(setDigestSettings(db, userId, { digest: "daily", digest_time: "06:45", timezone: "Mars/Olympus" })).rejects.toThrow(ValidationError);
  });

  it("goes to the address someone signs in with when they have no job inbox", async () => {
    const email = `digest-${tag}@example.test`;
    const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    const member = data.user.id;
    authIds.push(member);
    await db.from("users").insert({ id: member, role: "member" });
    await addApplication("member", "queued", member);

    const { counts } = await notify(day1, { user: member, from: "Jobrx <no-reply@jobrx.test>" });
    expect(counts).toMatchObject({ sent: 1 });
    expect(sent.at(-1)!.email.to).toBe(email);
  });
});
