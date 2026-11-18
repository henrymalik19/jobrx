// Admin > Users as the owner: answering a request to join with an invite, and removing and restoring a
// member's access. The test user is made the owner for this test (as the database tests do), and whoever
// owned the local stack before gets it back after.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { setOwner } from "@/server/auth/owner.repository";
import { requestAccess } from "@/server/modules/members/members.service";
import { E2E_USER, localAdmin } from "./local";

const db = localAdmin();

test("invites someone who asked to join, then removes and restores their access", async ({ page }) => {
  const { data: before } = await db.from("users").select("id").eq("role", "owner").maybeSingle();
  const email = `asked-${randomUUID().slice(0, 8)}@example.test`;
  await setOwner(db, E2E_USER.id);
  try {
    await requestAccess(db, { name: "Grace Hopper", email, note: "Compiler roles" });
    await page.goto("/admin/users");
    const request = page.getByRole("row").filter({ hasText: "Grace Hopper" });
    await expect(request).toContainText("Compiler roles");
    await request.getByRole("button", { name: "Invite" }).click();
    // Answered, the request leaves the list (and with nobody else waiting, the list goes).
    await expect(page.getByText("Requests to join")).toHaveCount(0);
    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row).toContainText("invited");
    await expect(row.getByRole("button", { name: "Resend invite" })).toBeVisible();

    await row.getByRole("button", { name: "Remove access" }).click();
    await expect(row).toContainText("removed");
    await row.getByRole("button", { name: "Restore access" }).click();
    await expect(row.getByRole("button", { name: "Remove access" })).toBeVisible();

    // The owner can't be removed: no button on their own row.
    const mine = page.getByRole("row").filter({ hasText: E2E_USER.email });
    await expect(mine.getByRole("button")).toHaveCount(0);
  } finally {
    const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
    for (const u of users.users.filter((x) => x.email === email)) {
      await db.from("users").delete().eq("id", u.id);
      await db.auth.admin.deleteUser(u.id);
    }
    await db.from("access_requests").delete().eq("email", email);
    if (before) await setOwner(db, before.id);
    else await db.from("users").update({ role: "member" }).eq("id", E2E_USER.id);
  }
});
