// Members: the test user is a member, so Admin isn't theirs; someone can ask to join; and an invite link
// takes a new member through choosing a password into their own workspace.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { inviteMember } from "@/server/modules/members/members.service";
import { localAdmin, localSupabase } from "./local";

const db = localAdmin();

test("a member doesn't see Admin, and is sent back from it", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("link", { name: "Overview" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);

  await page.goto("/admin/users");
  await page.waitForURL(/\/app$/);
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("asks to join from the sign-in page", async ({ page }) => {
    const email = `ask-${randomUUID().slice(0, 8)}@example.test`;
    try {
      await page.goto("/login");
      await page.getByRole("link", { name: "Request access" }).click();
      await page.getByLabel("Name").fill("Ada Lovelace");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel(/What are you looking for/).fill("Staff backend roles");
      await page.getByRole("button", { name: "Request access" }).click();
      await expect(page.getByRole("status")).toContainText("Your request is in");

      const { data } = await db.from("access_requests").select("name, note, status").eq("email", email);
      expect(data).toEqual([{ name: "Ada Lovelace", note: "Staff backend roles", status: "pending" }]);
    } finally {
      await db.from("access_requests").delete().eq("email", email);
      await db.from("notifications").delete().eq("dedupe_key", `access_request:${email}`);
    }
  });

  test("an invite link sets up the account and opens the app", async ({ page, baseURL }) => {
    const email = `invited-${randomUUID().slice(0, 8)}@example.test`;
    const id = await inviteMember(db, email);
    try {
      // The email Mailpit (the local stack's mailbox) caught; its link is on the stack's Site URL, so it's
      // opened on this test server instead.
      const mailpit = localSupabase().url.replace(":54321", ":54324");
      let html = "";
      await expect
        .poll(async () => {
          const found = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`).then((r) => r.json());
          const msg = found.messages?.[0]?.ID;
          html = msg ? (await fetch(`${mailpit}/api/v1/message/${msg}`).then((r) => r.json())).HTML : "";
          return html;
        })
        .toContain("/auth/confirm?token_hash=");
      const link = new URL(html.match(/href="([^"]*\/auth\/confirm[^"]*)"/)![1].replaceAll("&amp;", "&"));
      await page.goto(`${baseURL}${link.pathname}${link.search}`);

      await page.waitForURL(/\/login\/welcome$/);
      await expect(page.getByText(`You're joining as ${email}`)).toBeVisible();
      const password = `pw-${randomUUID()}`;
      await page.getByLabel("New password").fill(password);
      await page.getByLabel("Confirm password").fill(password);
      await page.getByRole("button", { name: "Set password and continue" }).click();
      await page.waitForURL(/\/app$/);
      await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeAttached();

      // The link worked once: opening it again goes to "request a new one".
      await page.context().clearCookies();
      await page.goto(`${baseURL}${link.pathname}${link.search}`);
      await page.waitForURL(/\/login\/forgot\?error=expired$/);
    } finally {
      await db.from("users").delete().eq("id", id);
      await db.auth.admin.deleteUser(id);
    }
  });
});
