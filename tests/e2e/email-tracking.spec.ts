// Email tracking on Settings: the member's private forwarding address, Gmail's forwarding confirmation shown to
// open, and the webhook Resend calls (refused unsigned; mail for nobody's address answered and dropped).
import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { E2E_USER, E2E_WEBHOOK_SECRET, localAdmin } from "./local";

test("shows the forwarding address, and Gmail's confirmation to open", async ({ page }) => {
  const db = localAdmin();
  const id = `e2e-${randomUUID().slice(0, 8)}`;
  try {
    await page.goto("/app/settings");
    const card = page.locator("[data-slot=card]").filter({ hasText: "Your forwarding address" });
    await expect(card.getByText("Not set up")).toBeVisible();
    await expect(card.getByText(/^u-[a-z0-9]{10}@in\.jobrx\.ai$/)).toBeVisible();
    // Without a verified application email there's nothing to send the test to.
    await expect(card.getByRole("button", { name: "Send a test" })).toBeDisabled();

    // Gmail's confirmation arrives at the forwarding address.
    await db.from("inbound_emails").insert({
      user_id: E2E_USER.id, provider_id: id, message_id: `<${id}@google.test>`, received_at: new Date().toISOString(),
      from_address: "forwarding-noreply@google.com", from_name: "Gmail Team",
      subject: `(#555444333) Gmail Forwarding Confirmation - Receive Mail from ${E2E_USER.email}`,
      text: `Confirmation code: 555444333\nhttps://mail-settings.google.com/mail/vf-e2e-link\n`,
    });
    await page.reload();
    await expect(card.getByText("Forwarding works")).toBeVisible();
    await expect(card.getByRole("link", { name: "Confirm it in Gmail" })).toHaveAttribute("href", "https://mail-settings.google.com/mail/vf-e2e-link");
    await expect(card.getByText("555444333")).toBeVisible();
  } finally {
    await db.from("inbound_emails").delete().eq("provider_id", id);
  }
});

test("Resend's webhook refuses an unsigned call and drops mail for nobody", async ({ request }) => {
  const body = JSON.stringify({ type: "email.received", data: { email_id: "e2e", to: ["u-nobody00000@in.jobrx.ai"] } });
  expect((await request.post("/api/inbound/resend", { data: body, headers: { "content-type": "application/json" } })).status()).toBe(401);

  const msgId = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", Buffer.from(E2E_WEBHOOK_SECRET.slice(6), "base64")).update(`${msgId}.${timestamp}.${body}`).digest("base64");
  const res = await request.post("/api/inbound/resend", {
    data: body,
    headers: { "content-type": "application/json", "svix-id": msgId, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` },
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ kept: 0 });
});
