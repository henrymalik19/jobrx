import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/server/db/service-client";
import { fetchReceivedEmail, receiveEmail, verifyWebhookSignature } from "@/server/modules/inbound/inbound.service";
import { serverEnv } from "@/shared/env";

/**
 * Resend's webhook for mail received on Jobrx's receiving domain (event `email.received`): checks the signature
 * (RESEND_WEBHOOK_SECRET), fetches the email (RESEND_API_KEY) and keeps it for whoever it was forwarded to.
 * Answers 200 once kept (or for mail nobody is owed), so Resend stops retrying; anything else is retried.
 */
export async function POST(request: NextRequest) {
  const env = serverEnv();
  if (!env.RESEND_WEBHOOK_SECRET || !env.RESEND_API_KEY) {
    return NextResponse.json({ error: "receiving isn't set up" }, { status: 503 });
  }
  const body = await request.text();
  const signed = verifyWebhookSignature(env.RESEND_WEBHOOK_SECRET, {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  }, body);
  if (!signed) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "not JSON" }, { status: 400 });
  }
  const key = env.RESEND_API_KEY;
  const kept = await receiveEmail(createServiceClient(env), event as Parameters<typeof receiveEmail>[1], (id) => fetchReceivedEmail(key, id));
  return NextResponse.json({ kept });
}
