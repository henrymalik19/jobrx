// To do > Unmatched emails: with both lists full (emails tracking couldn't read, and ones it couldn't place), the
// second list still shows: both scroll together instead of the first leaving the second no room.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { E2E_USER, localAdmin } from "./local";
import { seedCompany } from "./seed";

const db = localAdmin();
let seed: Awaited<ReturnType<typeof seedCompany>>;
const emailIds: string[] = [];
test.beforeEach(async () => {
  seed = await seedCompany(db);
});
test.afterEach(async () => {
  if (emailIds.length) await db.from("emails").delete().in("id", emailIds.splice(0));
  await seed.cleanup();
});

/** Saves an email in the job inbox as tracking would have, and returns its subject. */
async function email(subject: string, classification: string, from = "Hiring Team <no-reply@ashbyhq.com>") {
  const { data, error } = await db
    .from("emails")
    .insert({ user_id: E2E_USER.id, message_id: `<${randomUUID()}@e2e.test>`, received_at: new Date().toISOString(), from_addr: from, subject, snippet: `${subject}. A few words about it.`, classification, reason: "rules" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  emailIds.push(data.id);
  return subject;
}

test("shows emails it couldn't place below a full list of ones it couldn't read", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const app = await seed.application("receipt", "submitted");
  for (let i = 0; i < 6; i++) await email(`Unread ${i} ${seed.tag}`, "other");
  const unplaced = await email(`Thank you for applying ${seed.tag}`, "confirmation");

  await page.goto("/app/todo?tab=emails");
  await expect(page.getByText("Couldn't tell what it says")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: unplaced });
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeInViewport();

  // And it can be linked from there.
  await row.getByRole("combobox").last().selectOption({ label: `E2E Co ${seed.tag}: ${app.title}` });
  await row.getByRole("button", { name: "Link" }).click();
  await expect(row).toHaveCount(0);
  await expect.poll(() => seed.status(app.id)).toBe("confirmed");
});
