import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { gmailConfirmation, isOwnMail, verifyWebhookSignature } from "./inbound.service";

describe("verifyWebhookSignature", () => {
  const secret = `whsec_${Buffer.from("a test signing key of some length").toString("base64")}`;
  const now = new Date("2026-11-19T12:00:00Z");
  const timestamp = String(now.getTime() / 1000);
  const body = '{"type":"email.received","data":{"email_id":"e1"}}';
  const sign = (b: string, ts = timestamp, id = "msg_1") =>
    `v1,${createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${b}`).digest("base64")}`;

  it("accepts Resend's signature, among several", () => {
    expect(verifyWebhookSignature(secret, { id: "msg_1", timestamp, signature: sign(body) }, body, now)).toBe(true);
    expect(verifyWebhookSignature(secret, { id: "msg_1", timestamp, signature: `v1,bm90IGl0 ${sign(body)}` }, body, now)).toBe(true);
  });

  it("refuses a changed body, another id, an old timestamp, or missing headers", () => {
    expect(verifyWebhookSignature(secret, { id: "msg_1", timestamp, signature: sign(body) }, body.replace("e1", "e2"), now)).toBe(false);
    expect(verifyWebhookSignature(secret, { id: "msg_2", timestamp, signature: sign(body) }, body, now)).toBe(false);
    const old = String(now.getTime() / 1000 - 600);
    expect(verifyWebhookSignature(secret, { id: "msg_1", timestamp: old, signature: sign(body, old) }, body, now)).toBe(false);
    expect(verifyWebhookSignature(secret, { id: null, timestamp, signature: sign(body) }, body, now)).toBe(false);
    expect(verifyWebhookSignature(`whsec_${Buffer.from("another key").toString("base64")}`, { id: "msg_1", timestamp, signature: sign(body) }, body, now)).toBe(false);
  });
});

describe("gmailConfirmation", () => {
  it("finds the link and code in Gmail's forwarding confirmation", () => {
    const found = gmailConfirmation({
      subject: "(#123456789) Gmail Forwarding Confirmation - Receive Mail from ada@gmail.com",
      text: "ada@gmail.com has requested to automatically forward mail to your email address u-abc@in.jobrx.ai.\nConfirmation code: 123456789\n\nTo allow ada@gmail.com to automatically forward mail to your address, please click the link below to confirm the request:\n\nhttps://mail-settings.google.com/mail/vf-%5BANGjdJ8%5D-abc123\n\nIf you click the link and it appears to be broken...",
      receivedAt: new Date("2026-11-19T12:00:00Z"),
    });
    expect(found).toEqual({ from: "ada@gmail.com", link: "https://mail-settings.google.com/mail/vf-%5BANGjdJ8%5D-abc123", code: "123456789", receivedAt: "2026-11-19T12:00:00.000Z" });
  });

  it("is nothing for other mail", () => {
    expect(gmailConfirmation({ subject: "Your application", text: "", receivedAt: new Date() })).toBeNull();
  });
});

describe("isOwnMail", () => {
  it("knows Jobrx's own mail by its header or the test's subject", () => {
    expect(isOwnMail({ headers: { "x-autopilot": "notify" }, subject: "Jobrx: 1 reply" })).toBe(true);
    expect(isOwnMail({ headers: {}, subject: "Fwd: Jobrx forwarding test (12:00 UTC)" })).toBe(true);
    expect(isOwnMail({ headers: {}, subject: "Thanks for applying" })).toBe(false);
  });
});
