import type { Db } from "@/server/db/types";
import { z } from "zod";
import { unwrap, ValidationError } from "@/server/core/errors";
import { createSmtpSender, type SendEmail, type SmtpConfig } from "@/server/integrations/email/smtp";
import { blockingQuestions, listApplications } from "@/server/modules/applications/applications.service";
import { finishRun, startRun } from "@/server/modules/runs/runs.service";
import { getSetting, getUserSetting, putUserSetting } from "@/server/modules/settings/settings.service";
import { buildDigest, digestDue, isDue, NEWS_STATUSES, NOTIFY_HEADER, WAITING_STATUSES, type NewsItem, type NewsStatus, type NotifyItem } from "./digest";
import { lastSentAt, markNotified } from "./notifications.repository";

export * from "./digest";

const WORKER = "notify";
/** When nothing went out before, a first digest covers the day before it. */
const FIRST_DIGEST_HOURS = 24;

/** `user_settings.job_inbox`: the user's own job-search mailbox, if they have one (SMTP sends from it). */
const inboxSchema = z.object({
  address: z.string().email(),
  smtp_host: z.string().min(1).optional(),
  smtp_port: z.number().int().positive().optional(),
});

/**
 * `user_settings.notifications`: the daily digest. It goes to `to`, else the job inbox, else the address you
 * sign in with; from `from`, else the worker's default (Jobrx's own address through Resend). Older keys (quiet
 * hours, the gap between emails) are ignored.
 */
export const notifySchema = z.object({
  from: z.string().min(1).nullable().default(null),
  to: z.string().email().nullable().default(null),
  digest: z.enum(["daily", "off"]).default("daily"),
  digest_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("08:00"),
  timezone: z.string().default("America/New_York"),
});

/** The digest settings, as Settings shows them. */
export type DigestSettings = z.infer<typeof notifySchema>;

/** A user's digest settings, with defaults. */
export async function getDigestSettings(db: Db, userId: string): Promise<DigestSettings> {
  const parsed = notifySchema.safeParse((await getUserSetting(db, userId, "notifications")) ?? {});
  return parsed.success ? parsed.data : notifySchema.parse({});
}

/** True for a time zone this runtime knows (e.g. "America/New_York"). */
function knownTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** What Settings changes about the digest. */
export const digestInput = z.object({
  digest: z.enum(["daily", "off"]),
  digest_time: notifySchema.shape.digest_time.removeDefault().refine((t) => Number(t.slice(3)) % 15 === 0, "Pick a time on the quarter hour."),
  timezone: z.string().refine(knownTimeZone, "Pick a time zone from the list."),
});

/** Saves a user's digest settings, keeping the rest of `notifications` (who it's to and from) as it was. */
export async function setDigestSettings(db: Db, userId: string, input: z.input<typeof digestInput>): Promise<void> {
  const parsed = digestInput.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const current = (await getUserSetting(db, userId, "notifications")) ?? {};
  const rest = typeof current === "object" && !Array.isArray(current) ? current : {};
  await putUserSetting(db, userId, "notifications", { ...rest, ...parsed.data });
}

/** What the notify worker needs. */
export type NotifyDeps = {
  db: Db;
  /** Whose applications to email about. */
  userId: string;
  /** The job inbox's password; only SMTP (the default sender) uses it. */
  password: string;
  /** Builds the sender (default SMTP); workers pass Resend, tests a fake. */
  createSender?: (config: SmtpConfig) => SendEmail;
  /** Who the digest comes from when the user set no `from` (default: the job inbox, which SMTP signs in as). */
  from?: string;
  now?: Date;
  log?: (line: string) => void;
};

type Flag = { kind: string; excerpt: string };

const flagText = (f: Flag) =>
  f.kind === "ai_restriction" ? `the employer restricts AI use ("${f.excerpt}")` : `text aimed at AI tools ("${f.excerpt}")`;

/** Every application waiting on a user, as digest items, each with whether it's new to the digest. */
async function waitingItems(db: Db, userId: string): Promise<(NotifyItem & { fresh: boolean })[]> {
  const apps = await listApplications(db, userId, WAITING_STATUSES);
  return apps.map((a) => ({
    id: a.id,
    status: a.status as NotifyItem["status"],
    title: a.job.title,
    company: a.job.company_name,
    score: a.score,
    questions: a.status === "needs_input" ? blockingQuestions(a).map((q) => q.question) : [],
    flags: ((a.flags as Flag[] | null) ?? []).map(flagText),
    prepareError: a.status === "manual" ? a.prepare_error : null,
    fresh: isDue(a.status, a.notified_status),
  }));
}

type NewsRow = { application_id: string; to_status: NewsStatus; applications: { jobs: { title: string; company_name: string } } };

/** A user's applications that moved to a news status since `since`, each once, at its latest such move. */
async function newsSince(db: Db, userId: string, since: Date): Promise<NewsItem[]> {
  const rows = unwrap(
    await db
      .from("application_events")
      .select("application_id, to_status, created_at, applications!inner(user_id, jobs!inner(title, company_name))")
      .eq("applications.user_id", userId)
      .gt("created_at", since.toISOString())
      .in("to_status", [...NEWS_STATUSES])
      .order("created_at"),
    "list news",
  ) as unknown as NewsRow[];
  const latest = new Map<string, NewsItem>();
  for (const r of rows) {
    latest.set(r.application_id, { id: r.application_id, status: r.to_status, title: r.applications.jobs.title, company: r.applications.jobs.company_name });
  }
  return [...latest.values()];
}

/** The address someone signs in with. */
async function signInEmail(db: Db, userId: string): Promise<string | null> {
  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error) throw error;
  return data.user?.email ?? null;
}

/**
 * Notify worker, per user: once a day, at the user's digest time (`notifications.digest_time` in their time
 * zone), emails one digest of what moved since the last one and what's waiting on them. Nothing goes out on a
 * day with no news and nothing newly waiting, or when the digest is off. Each run is a `worker_runs` row
 * (worker `notify`); Railway runs it every 15 minutes, so it goes out within 15 minutes of the time.
 */
export async function runNotify(deps: NotifyDeps): Promise<{ counts: Record<string, number> }> {
  const { db, userId, now = new Date(), log = () => {}, createSender = createSmtpSender } = deps;
  const runId = await startRun(db, WORKER, null, userId);
  const counts: Record<string, number> = { sent: 0 };
  const done = async () => {
    await finishRun(db, runId, { ok: true, counts });
    return { counts };
  };
  try {
    const [inboxRaw, notifyRaw] = await Promise.all([getUserSetting(db, userId, "job_inbox"), getUserSetting(db, userId, "notifications")]);
    const settings = notifySchema.parse(notifyRaw ?? {});
    if (settings.digest === "off") {
      counts.off = 1;
      return await done();
    }
    const last = await lastSentAt(db, userId);
    if (!digestDue(now, { time: settings.digest_time, timezone: settings.timezone }, last)) {
      counts.not_yet = 1;
      return await done();
    }

    const since = last ?? new Date(now.getTime() - FIRST_DIGEST_HOURS * 3_600_000);
    const [waiting, news] = await Promise.all([waitingItems(db, userId), newsSince(db, userId, since)]);
    counts.due = news.length + waiting.filter((w) => w.fresh).length;
    if (counts.due === 0) {
      log("notify: nothing new since the last digest");
      return await done();
    }

    const inbox = inboxSchema.safeParse(inboxRaw ?? undefined);
    const mailbox = inbox.success ? inbox.data : null;
    const to = settings.to ?? mailbox?.address ?? (await signInEmail(db, userId));
    if (!to) throw new Error("no address to send the digest to");
    const from = settings.from ?? deps.from ?? (mailbox ? `Jobrx <${mailbox.address}>` : null);
    if (!from) throw new Error("no address to send the digest from");

    const appUrl = z.string().url().parse(await getSetting(db, "app_url"));
    const digest = buildDigest(waiting, news, appUrl, { time: settings.digest_time });
    const send = createSender({ host: mailbox?.smtp_host ?? "", port: mailbox?.smtp_port ?? 465, user: mailbox?.address ?? "", password: deps.password });
    await send({ from, to, ...digest, headers: { [NOTIFY_HEADER]: "notify" } });
    await markNotified(db, waiting);
    counts.sent = 1;
    counts.applications = news.length + waiting.length;
    log(`notify: sent "${digest.subject}"`);
    return await done();
  } catch (err) {
    await finishRun(db, runId, { ok: false, counts, error: String((err as Error)?.message ?? err) }).catch(() => {});
    throw err;
  }
}
export * from "./in-app";
