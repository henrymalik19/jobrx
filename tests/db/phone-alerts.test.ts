// Phone alerts and the runner's live view, against a local Supabase, as a signed-in member (the runner and
// the app act as you, so your data rules and storage folder apply).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Db } from "@/server/db/types";
import { liveViewWanted, loadLiveForms, removeLiveShot, uploadLiveShot, wantLiveView } from "@/server/modules/apply/live-view";
import { notify, relayPushesThrough } from "@/server/modules/notifications/in-app";
import { listPushDevices, removePushSubscription, savePushSubscription, sendPush, type PushSend } from "@/server/modules/notifications/push";
import type {} from "./setup";

const { url: URL, serviceRoleKey: SERVICE, anonKey: ANON } = inject("supabase");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(URL, SERVICE, opts) as unknown as Db;
let me: Db;
let userId = "";
const jobIds: string[] = [];

const sub = (n: number) => ({ endpoint: `https://push.example.test/${randomUUID()}-${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });

beforeAll(async () => {
  const email = `alerts-${randomUUID()}@example.test`;
  const password = randomUUID();
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await service.from("users").insert({ id: userId, role: "member" });
  me = createClient(URL, ANON, opts) as unknown as Db;
  const { error: e } = await me.auth.signInWithPassword({ email, password });
  if (e) throw e;
});

afterAll(async () => {
  relayPushesThrough(null);
  await service.storage.from("apply-runs").remove([`${userId}/live/x.jpg`]);
  await service.from("users").delete().eq("id", userId);
  if (jobIds.length) await service.from("jobs").delete().in("id", jobIds);
  await service.auth.admin.deleteUser(userId);
});

describe("phone alerts", () => {
  it("keeps one subscription per browser, sends to each, and forgets one the push service says is gone", async () => {
    const [a, b] = [sub(1), sub(2)];
    await savePushSubscription(me, userId, a, "iPhone (home screen app)");
    await savePushSubscription(me, userId, b, "Chrome on Windows");
    // Subscribing the same browser again replaces its row.
    await savePushSubscription(me, userId, a, "iPhone (home screen app)");
    expect((await listPushDevices(me, userId)).map((d) => d.device)).toEqual(["iPhone (home screen app)", "Chrome on Windows"]);

    const sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
    const send: PushSend = async (s, payload) => {
      if (s.endpoint === b.endpoint) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) });
    };
    const reached = await sendPush(me, userId, { title: "Waiting for you in Chrome: Engineer at Acme", body: "Click Submit", href: "/app/applications/1", tag: "n1" }, send);
    expect(reached).toBe(1);
    expect(sent).toEqual([{ endpoint: a.endpoint, payload: { title: "Waiting for you in Chrome: Engineer at Acme", body: "Click Submit", href: "/app/applications/1", tag: "n1" } }]);
    // The one that's gone is forgotten.
    expect((await listPushDevices(me, userId)).map((d) => d.endpoint)).toEqual([a.endpoint]);

    await removePushSubscription(me, userId, a.endpoint);
    expect(await listPushDevices(me, userId)).toEqual([]);
  });

  it("sends nothing without the app's keys, and never throws", async () => {
    await savePushSubscription(me, userId, sub(3), "Firefox on Linux");
    const keys = [process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY];
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    try {
      expect(await sendPush(me, userId, { title: "x" })).toBe(0);
    } finally {
      [process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY] = keys;
    }
  });

  it("alerts once for a new notification that needs you, never for a repeat or one that doesn't", async () => {
    const relayed: string[] = [];
    relayPushesThrough(async (id) => void relayed.push(id));
    const key = `test:${randomUUID()}`;
    await notify(me, userId, { kind: "runner_waiting", title: "Waiting for you in Chrome: Engineer at Acme", dedupeKey: key });
    await notify(me, userId, { kind: "runner_waiting", title: "Waiting for you in Chrome: Engineer at Acme", dedupeKey: key });
    await notify(me, userId, { kind: "submitted", title: "Submitted: Engineer at Acme" });
    const { data } = await me.from("notifications").select("id").eq("user_id", userId).eq("dedupe_key", key).single();
    expect(relayed).toEqual([data!.id]);
  });
});

describe("live view", () => {
  it("is wanted only while someone watches", async () => {
    const now = new Date();
    expect(await liveViewWanted(me, userId, now)).toBe(false);
    await wantLiveView(me, userId, now);
    expect(await liveViewWanted(me, userId, new Date(now.getTime() + 30_000))).toBe(true);
    expect(await liveViewWanted(me, userId, new Date(now.getTime() + 60_000))).toBe(false);
  });

  it("shows each open form with its latest screenshot, written over, and none once it's removed", async () => {
    const key = randomUUID();
    const { data: job } = await service.from("jobs").insert({
      company_name: "Acme", source: "greenhouse", external_id: key, url: `https://example.test/jobs/${key}`, title: "Engineer", dedup_key: key,
    }).select("id").single();
    jobIds.push(job!.id);
    const { data: app, error } = await service.from("applications")
      .insert({ user_id: userId, job_id: job!.id, status: "approved", apply_step: "waiting_for_you", apply_note: "Click Submit" }).select("id").single();
    if (error) throw error;

    expect(await loadLiveForms(me, userId)).toEqual([
      expect.objectContaining({ applicationId: app!.id, title: "Engineer", company: "Acme", step: "waiting_for_you", note: "Click Submit", shotUrl: null }),
    ]);
    const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, n, 0xff, 0xd9]);
    await uploadLiveShot(me, userId, app!.id, jpeg(1));
    await uploadLiveShot(me, userId, app!.id, jpeg(2));
    const [form] = await loadLiveForms(me, userId);
    expect(form.shotAt).toEqual(expect.any(String));
    const res = await fetch(form.shotUrl!);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...jpeg(2)]);

    // Someone else can't write into your folder.
    const { error: theirs } = await createClient(URL, ANON, opts).storage.from("apply-runs").upload(`${userId}/live/x.jpg`, jpeg(3), { contentType: "image/jpeg" });
    expect(theirs).not.toBeNull();

    await removeLiveShot(me, userId, app!.id);
    expect((await loadLiveForms(me, userId))[0].shotUrl).toBeNull();
  });
});
