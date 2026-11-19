import { describe, expect, it } from "vitest";
import { buildDigest, digestDue, formatTime, isDue, PER_SECTION, type NewsItem, type NotifyItem } from "./digest";

describe("isDue", () => {
  it("is due when a waiting status hasn't been emailed yet", () => {
    expect(isDue("needs_input", null)).toBe(true);
    expect(isDue("manual", "needs_input")).toBe(true);
  });
  it("isn't due once emailed in that status, or for a status that doesn't wait on you", () => {
    expect(isDue("needs_input", "needs_input")).toBe(false);
    expect(isDue("submitted", null)).toBe(false);
    expect(isDue("interviewing", null)).toBe(false);
  });
  it("counts ready to review only for a fresh application", () => {
    expect(isDue("queued", null)).toBe(true);
    expect(isDue("queued", "needs_input")).toBe(false);
  });
});

describe("digestDue", () => {
  const ny = { time: "08:00", timezone: "America/New_York" };
  it("waits for the digest time where you are", () => {
    expect(digestDue(new Date("2026-11-18T12:45:00Z"), ny, null)).toBe(false); // 7:45 EST
    expect(digestDue(new Date("2026-11-18T13:00:00Z"), ny, null)).toBe(true); // 8:00 EST
  });
  it("sends once a day, by your own date", () => {
    const sent = new Date("2026-11-18T13:05:00Z"); // 8:05 EST on the 18th
    expect(digestDue(new Date("2026-11-19T04:30:00Z"), ny, sent)).toBe(false); // 23:30 EST, still the 18th
    expect(digestDue(new Date("2026-11-19T13:00:00Z"), ny, sent)).toBe(true); // 8:00 on the 19th
  });
  it("uses the time zone you chose", () => {
    expect(digestDue(new Date("2026-11-18T13:00:00Z"), { time: "08:00", timezone: "America/Los_Angeles" }, null)).toBe(false); // 5:00 PST
  });
});

describe("formatTime", () => {
  it("reads as a clock time", () => {
    expect(formatTime("08:00")).toBe("8:00 AM");
    expect(formatTime("00:15")).toBe("12:15 AM");
    expect(formatTime("17:30")).toBe("5:30 PM");
  });
});

describe("buildDigest", () => {
  const item = (over: Partial<NotifyItem>): NotifyItem => ({
    id: "a1", status: "needs_input", title: "Staff Engineer", company: "Acme", score: 88, questions: [], flags: [], prepareError: null, ...over,
  });
  const news = (over: Partial<NewsItem>): NewsItem => ({ id: "n1", status: "interviewing", title: "Backend Lead", company: "Globex", ...over });

  it("puts news first, then what's waiting, and links every application", () => {
    const { subject, text, html } = buildDigest(
      [
        item({ questions: ["Do you hold a clearance?"] }),
        item({ id: "a2", status: "manual", title: "Platform <Lead>", prepareError: "no public form" }),
        item({ id: "a3", status: "queued" }),
      ],
      [news({}), news({ id: "n2", status: "rejected", title: "SRE", company: "Initech" })],
      "https://example.test/",
    );
    expect(subject).toBe("Jobrx: 1 interview invite, 1 rejection, 1 needs you, and more");
    expect(text.indexOf("Interview invites")).toBeLessThan(text.indexOf("Questions only you can answer"));
    expect(text).toContain("https://example.test/app/applications/a1");
    expect(text).toContain("Question: Do you hold a clearance?");
    expect(text).toContain("no public form");
    expect(html).toContain("Platform &lt;Lead&gt;");
    expect(html).toContain('href="https://example.test/app/todo?tab=answers"');
    expect(html).toContain('href="https://example.test/app/applications/n2"');
    expect(html).toContain("Open your to-do list");
  });

  it("is in the shared Jobrx look, with the time and a way to change it", () => {
    const { html, text } = buildDigest([], [news({})], "https://example.test", { time: "07:30" });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain(">Rx</td>");
    expect(html).toContain("Your daily update");
    expect(html).toContain("Nothing is waiting on you.");
    expect(html).toContain("at 7:30 AM");
    expect(html).toContain('href="https://example.test/app/settings"');
    expect(text).toContain("Change the time or turn it off: https://example.test/app/settings");
  });

  it("lists a few per section and links the rest", () => {
    const many = Array.from({ length: PER_SECTION + 3 }, (_, i) => item({ id: `q${i}`, status: "queued" }));
    const { html, text } = buildDigest(many, [], "https://example.test");
    expect(html).toContain("And 3 more");
    expect(text).toContain("And 3 more: https://example.test/app/todo?tab=ready");
    expect(html).not.toContain(`/app/applications/q${PER_SECTION}"`);
  });
});
