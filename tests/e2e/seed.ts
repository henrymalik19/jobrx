// Jobs and applications for one end-to-end test, owned by the test user, removed afterwards.
import { randomUUID } from "node:crypto";
import type { Db } from "@/server/db/types";
import type { AppStatus } from "@/server/modules/applications/application-status";
import { E2E_USER } from "./local";

/** One test's company, with a way to add applications to it and to remove everything it added. */
export async function seedCompany(db: Db) {
  const tag = randomUUID().slice(0, 8);
  const userId = E2E_USER.id;
  const { data: company, error } = await db.from("companies").insert({ name: `E2E Co ${tag}`, ats: "greenhouse", board_token: `e2e${tag}` }).select("id").single();
  if (error) throw new Error(error.message);
  const jobIds: string[] = [];

  return {
    tag,
    userId,
    /** Adds a job and the user's application to it, in this status; returns the application's id and title. */
    async application(key: string, status: AppStatus, extra: Record<string, string> = {}) {
      const title = `E2E ${key} ${tag}`;
      const { data: job, error: e1 } = await db
        .from("jobs")
        .insert({ company_id: company.id, company_name: `E2E Co ${tag}`, source: "greenhouse", external_id: `${tag}${key}`, url: `https://example.test/${tag}/${key}`, title, dedup_key: `${tag}-e2e-${key}` })
        .select("id")
        .single();
      if (e1) throw new Error(e1.message);
      jobIds.push(job.id);
      const { data: app, error: e2 } = await db.from("applications").insert({ user_id: userId, job_id: job.id, status, ...extra }).select("id").single();
      if (e2) throw new Error(e2.message);
      return { id: app.id, title };
    },
    /** The application's status now. */
    async status(applicationId: string) {
      const { data } = await db.from("applications").select("status").eq("id", applicationId).single();
      return data?.status;
    },
    async cleanup() {
      if (jobIds.length) {
        await db.from("applications").delete().in("job_id", jobIds);
        await db.from("jobs").delete().in("id", jobIds);
      }
      await db.from("companies").delete().eq("id", company.id);
    },
  };
}
