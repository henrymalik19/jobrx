// Per-user stages the worker entry points chain together. Each stage runs for
// every user in turn; one user's failure is logged and doesn't stop the others.
// A stage whose variable is missing is skipped with a log line.
import type { Db } from "@/server/db/types";
import { createClaudeCaller, DRAFTING_MODEL } from "@/server/integrations/anthropic/claude";
import { runMatch } from "@/server/modules/matching/matching.service";
import { createResendSender } from "@/server/integrations/email/resend";
import { runNotify } from "@/server/modules/notifications/notifications.service";
import { runPrepare } from "@/server/modules/prepare/prepare.service";
import { runTrackEmail } from "@/server/modules/tracking/tracking.service";
import { listUsers, type User } from "@/server/modules/users/users.service";
import { JOBRX_FROM } from "@/server/integrations/email/app-mail";
import { readInbox, type InboxConfig, type InboxMail } from "@/server/integrations/email/inbox";
import { readForwarded } from "@/server/modules/inbound/inbound.service";

/** One stage: what it does for one user, and the variables it needs (any one of them). */
type Stage = { name: string; needs?: string[]; run: (db: Db, userId: string, user: User) => Promise<{ counts: unknown }> };

const log = (line: string) => console.log(line);

/** Match (scoring). */
export const match: Stage = {
  name: "match",
  needs: ["ANTHROPIC_API_KEY"],
  /** Scores the user's new jobs. */
  run: (db, userId) => runMatch({ db, userId, call: createClaudeCaller(), log }),
};

/** Prepare; `limit` caps how many one run makes (below the daily cap). */
export const prepare = (limit?: number): Stage => ({
  name: "prepare",
  needs: ["ANTHROPIC_API_KEY"],
  run: (db, userId) => runPrepare({ db, userId, call: createClaudeCaller(), draftCall: createClaudeCaller(DRAFTING_MODEL), limit, log }),
});

/**
 * The owner's job inbox over IMAP, while JOB_INBOX_PASSWORD is set (the password is the owner's mailbox's, so
 * no one else's inbox is read this way); null otherwise.
 */
export async function ownerInbox(db: Db, userId: string, user: User): Promise<InboxConfig | null> {
  const password = process.env.JOB_INBOX_PASSWORD;
  if (user.role !== "owner" || !password) return null;
  const { data } = await db.from("user_settings").select("value").eq("user_id", userId).eq("key", "job_inbox").maybeSingle();
  const inbox = data?.value as { address?: string; imap_host?: string; imap_port?: number } | null;
  if (!inbox?.address) return null;
  return { host: inbox.imap_host ?? "imap.purelymail.com", port: inbox.imap_port ?? 993, user: inbox.address, password };
}

/** Email tracking: reads the user's application mail and moves applications by the replies. Claude sorts unclear mail when there's a key. */
export const trackEmail: Stage = {
  name: "track_email",
  /**
   * Reads what was forwarded to the user's Jobrx address, and for the owner their job inbox too (over IMAP,
   * while it has a password), and moves applications by what arrived.
   */
  run: async (db, userId, user) => {
    const imap = await ownerInbox(db, userId, user);
    const readMail = async (since: Date): Promise<InboxMail[]> => {
      const [forwarded, own] = await Promise.all([readForwarded(db, userId, since), imap ? readInbox(imap, since) : []]);
      return [...forwarded, ...own].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    };
    return runTrackEmail({ db, userId, readMail, call: process.env.ANTHROPIC_API_KEY ? createClaudeCaller() : undefined, log });
  },
};

/** Who the digest comes from through Resend (send.jobrx.ai is verified there). */

/** Notify (the digest email). */
export const notify: Stage = {
  name: "notify",
  needs: ["RESEND_API_KEY", "JOB_INBOX_PASSWORD"],
  /**
   * Emails the user's digest: through Resend when RESEND_API_KEY is set (Railway blocks SMTP), from Jobrx's own
   * address (NOTIFY_FROM) so it works for every user's inbox; else SMTP, from the job inbox.
   */
  run: (db, userId) => {
    const key = process.env.RESEND_API_KEY;
    const createSender = key ? () => createResendSender(key) : undefined;
    const from = key ? process.env.NOTIFY_FROM || JOBRX_FROM : undefined;
    return runNotify({ db, userId, password: process.env.JOB_INBOX_PASSWORD ?? "", createSender, from, log });
  },
};

/**
 * Runs stages in order, each for every user.
 *
 * @returns Whether every stage succeeded for every user.
 */
export async function runStages(db: Db, stages: Stage[]): Promise<boolean> {
  const users = await listUsers(db);
  let ok = true;
  for (const stage of stages) {
    if (stage.needs && !stage.needs.some((name) => process.env[name])) {
      console.log(JSON.stringify({ stage: stage.name, skipped: `${stage.needs.join(" or ")} is not set` }));
      continue;
    }
    for (const user of users) {
      try {
        const { counts } = await stage.run(db, user.id, user);
        console.log(JSON.stringify({ stage: stage.name, user: user.id, ok: true, counts }));
      } catch (err) {
        ok = false;
        console.error(JSON.stringify({ stage: stage.name, user: user.id, ok: false, error: String((err as Error)?.message ?? err) }));
      }
    }
  }
  return ok;
}
