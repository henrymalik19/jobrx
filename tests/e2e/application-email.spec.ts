// The application email on Profile: a different address than the sign-in one waits unverified, a link is
// emailed to it (Mailpit, the local stack's mailbox), and opening it verifies the address.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { E2E_USER, localAdmin, localSupabase } from "./local";

test("verifies a different application email through the emailed link", async ({ page, baseURL }) => {
  const db = localAdmin();
  const email = `apply-${randomUUID().slice(0, 8)}@example.test`;
  const { data: before } = await db.from("profiles").select("email").eq("user_id", E2E_USER.id).maybeSingle();
  try {
    await page.goto("/app/profile");
    await page.getByLabel("Application email").fill(email);
    await page.getByRole("button", { name: "Save profile" }).click();
    const note = page.getByRole("note");
    await expect(note).toContainText(`${email} isn't verified yet`);

    await note.getByRole("button", { name: "Send verification link" }).click();
    await expect(note.getByText("Sent. Open the link")).toBeVisible();

    const mailpit = localSupabase().url.replace(":54321", ":54324");
    let html = "";
    await expect
      .poll(async () => {
        const found = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`).then((r) => r.json());
        const id = found.messages?.[0]?.ID;
        html = id ? (await fetch(`${mailpit}/api/v1/message/${id}`).then((r) => r.json())).HTML : "";
        return html;
      })
      .toContain("Verify your application email");
    // The link is on the app's own address (app_url); opened on this test server instead.
    const link = new URL(html.match(/href="([^"]*\/verify-email\?token=[^"]+)"/)![1].replaceAll("&amp;", "&"));
    await page.goto(`${baseURL}${link.pathname}${link.search}`);
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();

    await page.getByRole("link", { name: "Open your profile" }).click();
    await expect(page.getByText(`${email} is verified`)).toBeVisible();
  } finally {
    await db.from("profiles").update({ email: before?.email ?? null }).eq("user_id", E2E_USER.id);
  }
});
