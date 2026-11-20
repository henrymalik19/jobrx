// What the apply runner and the desktop app (desktop/) say to each other when the app starts it: the app
// signs you in, starts and restarts the runner, and shows what it's doing in the menu bar (tray on Windows).

/** The runner exits with this when it has no session to sign in with: the app asks you, then starts it again. */
export const SIGNED_OUT_EXIT = 77;

/** An application filled and waiting for you. */
export type WaitingForm = { id: string; title: string; company: string };

/** From the runner to the app. */
export type RunnerMessage =
  | { type: "log"; line: string }
  | { type: "state"; name: string; filling: number; waiting: WaitingForm[]; paused: boolean; linkedinPaused: boolean; updating: boolean }
  | { type: "waiting"; form: WaitingForm }
  | { type: "notice"; title: string; body: string };

/** From the app to the runner. */
export type AppMessage =
  | { type: "stop" }
  | { type: "focus"; id: string }
  | { type: "pause"; paused: boolean };

/** The channel to the app when the app started this process (Electron's utilityProcess), else null. */
export type ParentPort = { postMessage(message: RunnerMessage): void; on(event: "message", listener: (e: { data: AppMessage }) => void): void };

/** This process's channel to the desktop app, when it has one. */
export function desktopPort(): ParentPort | null {
  return (process as unknown as { parentPort?: ParentPort }).parentPort ?? null;
}
