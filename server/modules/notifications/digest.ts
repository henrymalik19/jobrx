// Pure parts of the notify worker: when the daily digest is due, and the digest email itself (what changed
// since the last one, and what's waiting on you), in the look every Jobrx email shares.
import { EMAIL_COLORS, escapeHtml, link, paragraph, renderEmail } from "@/server/integrations/email/layout";

/** Statuses that wait on you; a digest lists every application in one. */
export const WAITING_STATUSES = ["needs_input", "manual", "queued"] as const;
/** A status that waits on you. */
export type WaitingStatus = (typeof WAITING_STATUSES)[number];
/** Statuses an application is emailed about once it reaches them (`applications.notified_status` records it). */
export const NOTIFY_STATUSES = WAITING_STATUSES;
/** A status that is worth an email. */
export type NotifyStatus = WaitingStatus;

/** Moves that are news in a digest: an application sent, a reply, an interview, an offer, a no. */
export const NEWS_STATUSES = ["submitted", "confirmed", "responded", "interviewing", "offer", "rejected"] as const;
/** A move that's news. */
export type NewsStatus = (typeof NEWS_STATUSES)[number];

/** Header on every notification, so the inbox reader skips our own mail. */
export const NOTIFY_HEADER = "X-Autopilot";

/** One application waiting on you, in a digest. */
export type NotifyItem = {
  id: string;
  status: NotifyStatus;
  title: string;
  company: string;
  score: number | null;
  /** Required questions only you can answer (needs_input). */
  questions: string[];
  /** Short descriptions of the application's flags. */
  flags: string[];
  /** Why the form couldn't be filled (manual). */
  prepareError: string | null;
};

/** One application that moved since the last digest (its latest move). */
export type NewsItem = { id: string; status: NewsStatus; title: string; company: string };

/**
 * True when an application waiting on you is new to the digest: it hasn't been emailed in this status. "Ready
 * to review" counts only for a fresh application, not one that got there because you answered its questions.
 *
 * @param notifiedStatus - `applications.notified_status`.
 */
export function isDue(status: string, notifiedStatus: string | null): status is NotifyStatus {
  if (!(NOTIFY_STATUSES as readonly string[]).includes(status) || status === notifiedStatus) return false;
  return status !== "queued" || notifiedStatus === null;
}

/** When the digest goes out: a local "HH:MM" time in an IANA time zone. */
export type DigestSchedule = { time: string; timezone: string };

/** A moment's local date ("YYYY-MM-DD") and minutes past midnight in a time zone. */
function local(at: Date, timezone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/**
 * True when today's digest is due: it's past the digest time where you are, and none went out yet today
 * (your day, in your time zone).
 *
 * @param lastSent - When the last digest went out, or null.
 */
export function digestDue(now: Date, schedule: DigestSchedule, lastSent: Date | null): boolean {
  const today = local(now, schedule.timezone);
  const [h, m] = schedule.time.split(":").map(Number);
  if (today.minutes < h * 60 + m) return false;
  return !lastSent || local(lastSent, schedule.timezone).date !== today.date;
}

/** "08:00" → "8:00 AM". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** At most this many applications are listed per section; the rest are a link. */
export const PER_SECTION = 8;

type Section<S extends string> = { status: S[]; heading: string; page: string; count: (n: number) => string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** News, most important first. */
const NEWS: Section<NewsStatus>[] = [
  { status: ["offer"], heading: "Offers", page: "/app", count: (n) => plural(n, "offer", "offers") },
  { status: ["interviewing"], heading: "Interview invites", page: "/app", count: (n) => plural(n, "interview invite", "interview invites") },
  { status: ["responded"], heading: "Replies", page: "/app", count: (n) => plural(n, "reply", "replies") },
  { status: ["rejected"], heading: "Not moving forward", page: "/app", count: (n) => plural(n, "rejection", "rejections") },
  { status: ["submitted", "confirmed"], heading: "Applied", page: "/app", count: (n) => `${n} applied` },
];

/** What waits on you. */
const WAITING: Section<WaitingStatus>[] = [
  { status: ["needs_input"], heading: "Questions only you can answer", page: "/app/todo?tab=answers", count: (n) => `${n} need${n === 1 ? "s" : ""} you` },
  { status: ["manual"], heading: "Apply on the site yourself", page: "/app/applying", count: (n) => `${n} to apply by hand` },
  { status: ["queued"], heading: "Ready to review", page: "/app/todo?tab=ready", count: (n) => `${n} ready to review` },
];

/** Detail lines under an application waiting on you: blocking questions, flags, why it's manual. */
function details(item: NotifyItem): string[] {
  return [
    ...item.questions.map((q) => `Question: ${q}`),
    ...item.flags.map((f) => `Flag: ${f}`),
    ...(item.prepareError ? [item.prepareError] : []),
  ];
}

type Row = { id: string; title: string; company: string; details: string[] };
type Group = { heading: string; page: string; count: string; rows: Row[] };

function groups<S extends string, T extends { status: S }>(sections: Section<S>[], items: T[], row: (i: T) => Row): Group[] {
  return sections
    .map((s) => {
      const mine = items.filter((i) => s.status.includes(i.status));
      return { heading: s.heading, page: s.page, count: s.count(mine.length), rows: mine.map(row) };
    })
    .filter((g) => g.rows.length > 0);
}

function htmlGroup(g: Group, base: string): string {
  const c = EMAIL_COLORS;
  const shown = g.rows.slice(0, PER_SECTION);
  const more = g.rows.length - shown.length;
  const rows = shown
    .map((r) => {
      const sub = r.details.map((d) => `<div style="font-size:13px;line-height:19px;color:${c.muted};margin-top:2px">${escapeHtml(d)}</div>`).join("");
      return `<tr><td style="padding:10px 0;border-top:1px solid ${c.rule}">
                    <a href="${escapeHtml(`${base}/app/applications/${r.id}`)}" style="font-size:15px;line-height:22px;color:${c.text};font-weight:600;text-decoration:none">${escapeHtml(r.title)}</a>
                    <div style="font-size:14px;line-height:20px;color:${c.body}">${escapeHtml(r.company)}</div>${sub}
                  </td></tr>`;
    })
    .join("");
  const tail = more > 0 ? `<tr><td style="padding:10px 0;border-top:1px solid ${c.rule};font-size:14px">${link(`And ${more} more`, `${base}${g.page}`)}</td></tr>` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr><td style="padding:20px 0 6px;font-size:13px;line-height:18px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${c.muted}">
                    <a href="${escapeHtml(`${base}${g.page}`)}" style="color:${c.muted};text-decoration:none">${escapeHtml(g.heading)}</a> · ${g.rows.length}
                  </td></tr>${rows}${tail}
                </table>`;
}

function textGroup(g: Group, base: string): string {
  const shown = g.rows.slice(0, PER_SECTION);
  const more = g.rows.length - shown.length;
  return [
    `${g.heading} (${g.rows.length}): ${base}${g.page}`,
    ...shown.flatMap((r) => [`- ${r.title} at ${r.company}: ${base}/app/applications/${r.id}`, ...r.details.map((d) => `    ${d}`)]),
    ...(more > 0 ? [`  And ${more} more: ${base}${g.page}`] : []),
  ].join("\n");
}

/** What the digest says about itself in its footnote. */
export type DigestFooter = { time: string; settingsUrl?: string };

/**
 * The daily digest: what moved since the last one (offers, interviews, replies, nos, applications sent), then
 * everything waiting on you, each application linked. A subject with the counts, plain text and HTML.
 *
 * @param appUrl - The web app's origin, e.g. `https://jobrx.ai`.
 */
export function buildDigest(
  waiting: NotifyItem[],
  news: NewsItem[],
  appUrl: string,
  footer: DigestFooter = { time: "08:00" },
): { subject: string; text: string; html: string } {
  const base = appUrl.replace(/\/$/, "");
  const newsGroups = groups(NEWS, news, (n) => ({ id: n.id, title: n.title, company: n.company, details: [] }));
  const waitingGroups = groups(WAITING, waiting, (i) => ({ id: i.id, title: i.title, company: i.company, details: details(i) }));
  const counts = [...newsGroups, ...waitingGroups].map((g) => g.count);
  const subject = counts.length ? `Jobrx: ${counts.slice(0, 3).join(", ")}${counts.length > 3 ? ", and more" : ""}` : "Jobrx: your daily update";
  const settingsUrl = footer.settingsUrl ?? `${base}/app/settings`;
  const when = formatTime(footer.time);

  const lead = waitingGroups.length
    ? "Here's what changed since your last update, and what's waiting on you."
    : "Here's what changed since your last update. Nothing is waiting on you.";

  const html = renderEmail({
    title: subject,
    preview: counts.join(", "),
    heading: "Your daily update",
    body: [
      paragraph(lead, { last: true }),
      ...(newsGroups.length ? newsGroups.map((g) => htmlGroup(g, base)) : []),
      ...waitingGroups.map((g) => htmlGroup(g, base)),
      `<div style="height:20px;line-height:20px">&nbsp;</div>`,
    ].join("\n"),
    button: { label: waitingGroups.length ? "Open your to-do list" : "Open Jobrx", href: `${base}${waitingGroups.length ? "/app/todo" : "/app"}` },
    footnote: `This comes once a day at ${escapeHtml(when)}, when something changed. ${link("Change the time or turn it off", settingsUrl, EMAIL_COLORS.muted)}.`,
  });

  const text = [
    lead,
    ...newsGroups.map((g) => textGroup(g, base)),
    ...waitingGroups.map((g) => textGroup(g, base)),
    `This comes once a day at ${when}, when something changed. Change the time or turn it off: ${settingsUrl}`,
  ].join("\n\n");

  return { subject, text: `${text}\n`, html };
}
