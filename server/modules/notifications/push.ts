// Phone alerts (web push): the notifications that need you, sent to every browser or installed app you turned
// alerts on in. The bell in the app still shows every notification; these are the ones worth a buzz.
//
// Sending needs the app's VAPID keys (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY): the web app and the Railway workers
// have them and send directly. The apply runner on your computer doesn't, so it asks the app to send its own
// (POST /api/runner/push). Without the keys nothing is sent and nothing fails.
import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import type { Db } from "@/server/db/types";
import { check, unwrap } from "@/server/core/errors";
import type { NotificationKind } from "./in-app";

/** The kinds that need you soon: the runner waiting or stuck, an interview invite, a reply. */
export const PUSH_KINDS: ReadonlySet<NotificationKind> = new Set(["runner_waiting", "runner_stuck", "interview", "reply"]);

/** What a phone alert shows, and where tapping it leads. */
export type PushMessage = { title: string; body?: string | null; href?: string | null; tag?: string };

/** The keys to send with, or null when they aren't set. */
export function vapidKeys(env: Record<string, string | undefined> = process.env): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: env.VAPID_SUBJECT?.trim() || "https://jobrx.ai" };
}

/** A browser's subscription as it hands it over (PushSubscription.toJSON()). */
export type BrowserSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

/** Saves a browser's subscription for a user (one row per browser; subscribing again replaces it). */
export async function savePushSubscription(db: Db, userId: string, sub: BrowserSubscription, device: string): Promise<void> {
  if (!/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("not a push subscription");
  check(
    await db.from("push_subscriptions").upsert(
      { user_id: userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, device: device.slice(0, 100) },
      { onConflict: "endpoint" },
    ),
    "save push subscription",
  );
}

/** Forgets a browser's subscription (turned off there). */
export async function removePushSubscription(db: Db, userId: string, endpoint: string): Promise<void> {
  check(await db.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint), "remove push subscription");
}

/** The browsers a user gets alerts in. */
export async function listPushDevices(db: Db, userId: string): Promise<{ endpoint: string; device: string; createdAt: string }[]> {
  const rows = unwrap(
    await db.from("push_subscriptions").select("endpoint, device, created_at").eq("user_id", userId).order("created_at"),
    "list push subscriptions",
  );
  return rows.map((r) => ({ endpoint: r.endpoint, device: r.device, createdAt: r.created_at }));
}

/** Sends one push; how it's sent is swapped in tests. */
export type PushSend = (sub: WebPushSubscription, payload: string) => Promise<unknown>;

/**
 * Sends an alert to every browser a user turned alerts on in. One the push service says is gone (unsubscribed,
 * expired) is forgotten. Never throws: an alert that can't go out shouldn't stop the work it's about.
 *
 * @returns How many browsers it reached.
 */
export async function sendPush(db: Db, userId: string, message: PushMessage, send?: PushSend): Promise<number> {
  try {
    const keys = vapidKeys();
    if (!keys && !send) return 0;
    const deliver: PushSend = send ?? ((sub, payload) => webpush.sendNotification(sub, payload, { vapidDetails: keys!, TTL: 6 * 3600, urgency: "high" }));
    const { data: subs, error } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
    if (error || !subs?.length) return 0;
    const payload = JSON.stringify({ title: message.title.slice(0, 120), body: message.body?.slice(0, 300) ?? "", href: message.href ?? "/app", tag: message.tag });
    let reached = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await deliver({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
          reached++;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
          else console.error(`push not sent: ${status ?? ""} ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );
    return reached;
  } catch (err) {
    console.error(`push not sent: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}
