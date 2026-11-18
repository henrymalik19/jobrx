// The apply runner asks here for a notification it just made (waiting for you, stuck) to go to your phone: it
// has no push keys of its own. Only a notification of yours, of a kind that alerts, made in the last few
// minutes is sent, so a replayed request can't send old ones again and again.
import { z } from "zod";
import { pushMessage } from "@/server/modules/notifications/in-app";
import { PUSH_KINDS, sendPush } from "@/server/modules/notifications/push";
import type { NotificationKind } from "@/server/modules/notifications/in-app";
import { runnerUser } from "../auth";

const body = z.object({ notificationId: z.string().uuid() });
const FRESH_MS = 5 * 60_000;

/** Sends the signed-in user's notification to their phone; answers how many browsers it reached. */
export async function POST(request: Request): Promise<Response> {
  const user = await runnerUser(request);
  if (user instanceof Response) return user;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const { data: n } = await user.db
    .from("notifications")
    .select("id, kind, title, body, href, created_at")
    .eq("id", parsed.data.notificationId)
    .eq("user_id", user.userId)
    .maybeSingle();
  if (!n) return Response.json({ error: "not found" }, { status: 404 });
  if (!PUSH_KINDS.has(n.kind as NotificationKind) || Date.now() - new Date(n.created_at).getTime() > FRESH_MS) return Response.json({ reached: 0 });
  // The user's own client: their push subscriptions are theirs to read under the data rules.
  return Response.json({ reached: await sendPush(user.db, user.userId, pushMessage(n)) });
}
