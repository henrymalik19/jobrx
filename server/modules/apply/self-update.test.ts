import { describe, expect, it } from "vitest";
import { needsInstall, nextUpdateStep, type UpdateState } from "./self-update";

const base: UpdateState = { started: "a1", head: "a1", branch: "main", dirty: false, behindRemote: 0, ahead: 0 };

describe("nextUpdateStep", () => {
  it("does nothing when it runs the newest code", () => {
    expect(nextUpdateStep(base)).toEqual({ kind: "none" });
    // GitHub couldn't be asked: nothing either.
    expect(nextUpdateStep({ ...base, behindRemote: null })).toEqual({ kind: "none" });
  });

  it("pulls a plain fast-forward of main", () => {
    expect(nextUpdateStep({ ...base, behindRemote: 3 })).toEqual({ kind: "pull" });
  });

  it("restarts when the folder already moved on (you pulled)", () => {
    expect(nextUpdateStep({ ...base, head: "b2" })).toEqual({ kind: "restart" });
  });

  it("never pulls over your work, and says why", () => {
    expect(nextUpdateStep({ ...base, behindRemote: 1, dirty: true })).toEqual({ kind: "blocked", why: "the folder has uncommitted changes" });
    expect(nextUpdateStep({ ...base, behindRemote: 1, ahead: 2 })).toEqual({ kind: "blocked", why: "the folder has 2 commit(s) GitHub doesn't" });
    expect(nextUpdateStep({ ...base, behindRemote: 1, branch: "try-ashby" })).toEqual({ kind: "blocked", why: "the folder is on branch try-ashby, not main" });
    expect(nextUpdateStep({ ...base, behindRemote: 1, branch: "HEAD" })).toEqual({ kind: "blocked", why: "the folder is on no branch, not main" });
  });

  it("uncommitted changes alone don't stop a restart onto code you pulled", () => {
    expect(nextUpdateStep({ ...base, head: "b2", dirty: true })).toEqual({ kind: "restart" });
  });
});

describe("needsInstall", () => {
  it("installs when the dependencies changed", () => {
    expect(needsInstall(["pnpm-lock.yaml", "workers/apply.ts"])).toBe(true);
    expect(needsInstall(["package.json"])).toBe(true);
    expect(needsInstall(["server/x.ts"])).toBe(false);
  });
});
