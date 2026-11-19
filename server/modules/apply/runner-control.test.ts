import { describe, expect, it } from "vitest";
import { newFormActions, restartAsked, runnerControlSchema } from "./runner-control";

const control = (forms: Record<string, { action: "submit" | "hand_back"; at: string }>, restart_at: string | null = null) =>
  runnerControlSchema.parse({ forms, restart_at });

describe("runner control", () => {
  it("reads nothing asked from an empty setting", () => {
    expect(runnerControlSchema.parse({})).toEqual({ paused: false, linkedin_paused: false, restart_at: null, forms: {} });
  });

  it("takes each form's action once, and only for forms the runner has open", () => {
    const done = new Map<string, string>();
    const asked = control({ a: { action: "submit", at: "2026-11-19T18:00:00Z" }, gone: { action: "hand_back", at: "2026-11-19T18:00:00Z" } });
    expect([...newFormActions(asked, ["a", "b"], done)]).toEqual([["a", "submit"]]);
    done.set("a", "2026-11-19T18:00:00Z");
    expect(newFormActions(asked, ["a", "b"], done).size).toBe(0);
    // Asked again later: done again.
    const again = control({ a: { action: "hand_back", at: "2026-11-19T18:05:00Z" } });
    expect([...newFormActions(again, ["a"], done)]).toEqual([["a", "hand_back"]]);
  });

  it("restarts only for a restart asked after the runner started", () => {
    expect(restartAsked(control({}, "2026-11-19T18:00:00.000Z"), "2026-11-19T17:00:00.000Z")).toBe(true);
    expect(restartAsked(control({}, "2026-11-19T16:00:00.000Z"), "2026-11-19T17:00:00.000Z")).toBe(false);
    expect(restartAsked(control({}), "2026-11-19T17:00:00.000Z")).toBe(false);
  });
});
