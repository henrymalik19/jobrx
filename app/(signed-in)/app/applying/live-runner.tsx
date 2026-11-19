"use client";

// What the runner is doing right now: each form it has open in Chrome, with its step and a screenshot taken a
// few seconds ago. Asked for every few seconds while the page is in view (which keeps the runner taking them);
// hidden, it stops asking, and the runner stops soon after. It's also where you control the runner from anywhere:
// pause it, pause LinkedIn, restart it, and submit or hand back a form waiting for you.
import { Pause, Play, RotateCw, Send, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/cn";
import { APPLY_STEP_TITLE, TONE_BADGE } from "../../_components/status";
import { RemoteFields } from "./remote-fields";
import { formAction, liveViewAction, pauseLinkedInAction, pauseRunnerAction, restartRunnerAction, type ControlResult, type LiveView } from "./actions";

/** Runs a control action, then shows the view it answers with, or its error. */
function useControl(onView: (v: LiveView) => void) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<ControlResult>) =>
    start(async () => {
      setError(null);
      const result = await action().catch((): ControlResult => ({ error: "That didn't go through; try again." }));
      if (result.error) setError(result.error);
      if (result.view) onView(result.view);
    });
  return { pending, error, run };
}

/** The runner on or off, and its controls: pause, LinkedIn only, restart. */
function RunnerBar({ view, onView, now }: { view: LiveView; onView: (v: LiveView) => void; now: number }) {
  const { pending, error, run } = useControl(onView);
  const state = !view.running
    ? `Runner is off${view.seenAt ? ` (last seen ${since(view.seenAt, now)})` : ""}.`
    : view.restarting
      ? "Restarting once what's open is done; nothing new starts meanwhile."
      : view.paused
        ? view.pausedSeen ? "Paused: nothing new starts. What's open stays open." : "Pausing…"
        : view.linkedinPaused
          ? "Runner is on; LinkedIn is paused."
          : "Runner is on.";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center text-sm text-muted-foreground" role="status">
          <span className={cn("mr-2 inline-block size-2 rounded-full", !view.running ? "bg-zinc-400" : view.paused ? "bg-amber-500" : "bg-emerald-500")} />
          {state}
        </span>
        {view.running && (
          <span className="flex flex-wrap items-center gap-1.5">
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => pauseRunnerAction(!view.paused))}>
              {view.paused ? <><Play /> Resume</> : <><Pause /> Pause</>}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => pauseLinkedInAction(!view.linkedinPaused))}>
              {view.linkedinPaused ? <><Play /> Resume LinkedIn</> : <><Pause /> Pause LinkedIn</>}
            </Button>
            {view.canRestart && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || view.restarting}
                title="Restarts on the latest code once what's open is done"
                onClick={() => run(restartRunnerAction)}
              >
                <RotateCw /> Restart
              </Button>
            )}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Submit it (asked once more) or Hand back, for a form filled and waiting for you; then what was asked. */
function FormControls({ form, view, onView, now }: { form: LiveView["forms"][number]; view: LiveView; onView: (v: LiveView) => void; now: number }) {
  const { pending, error, run } = useControl(onView);
  const [confirm, setConfirm] = useState(false);
  const asked = view.asked[form.applicationId];
  if (form.step !== "waiting_for_you" || !view.running) return null;
  // Asked a moment ago and not done yet: the runner reads it within a few seconds.
  const fresh = !!asked && now - new Date(asked.at).getTime() < 60_000;
  if (fresh && !error) {
    return <p className="text-xs text-muted-foreground" role="status">{asked.action === "submit" ? "Submitting…" : "Handing back…"}</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      {confirm ? (
        <div className="flex items-center gap-1.5">
          <Button type="button" size="sm" disabled={pending} className="bg-success text-background hover:bg-success/85" onClick={() => run(() => formAction(form.applicationId, "submit"))}>
            <Send /> Submit now
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(false)}>Cancel</Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" disabled={pending} title="Clicks Submit on the form in Chrome, as it is now" onClick={() => setConfirm(true)}>
            <Send /> Submit it
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={pending} title="Closes the form unsent; the application goes to Runner stuck" onClick={() => run(() => formAction(form.applicationId, "hand_back"))}>
            <Undo2 /> Hand back
          </Button>
        </div>
      )}
      {confirm && <p className="text-xs text-muted-foreground">Sends the form as the screenshot shows it.</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

const EVERY_MS = 5_000;

/** Seconds or minutes since a time, kept short for a caption. */
function since(iso: string | null, now: number): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

/** The forms the runner has open now, each with its step and latest screenshot. */
export function LiveRunner() {
  const [view, setView] = useState<LiveView | null>(null);
  // Set with each answer (nothing shows before the first, so no clock is read while rendering on the server).
  const [now, setNow] = useState(0);
  const [big, setBig] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        const next = await liveViewAction().catch(() => null);
        if (!stopped && next) setView(next);
        setNow(Date.now());
      }
      timer = setTimeout(tick, EVERY_MS);
    };
    void tick();
    const back = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);

  // Escape closes the bigger screenshot.
  useEffect(() => {
    if (!big) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setBig(null);
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [big]);

  if (!view) return null;
  if (view.forms.length === 0) {
    return (
      <section aria-label="Runner" className="flex flex-col gap-1">
        <RunnerBar view={view} onView={setView} now={now} />
        {view.running && <p className="text-sm text-muted-foreground">Nothing open in Chrome right now.</p>}
      </section>
    );
  }
  const zoomed = view.forms.find((f) => f.applicationId === big);
  return (
    <section aria-label="Open in Chrome now" className="flex flex-col gap-2">
      <RunnerBar view={view} onView={setView} now={now} />
      <h2 className="text-sm font-medium">Open in Chrome now</h2>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {view.forms.map((f) => (
          <article key={f.applicationId} className="flex w-64 shrink-0 flex-col gap-2 rounded-lg border bg-card p-2 sm:w-72">
            <button
              type="button"
              onClick={() => setBig(f.applicationId)}
              disabled={!f.shotUrl}
              className="aspect-[4/3] w-full overflow-hidden rounded-md bg-muted"
              aria-label={`Bigger screenshot of ${f.title} at ${f.company}`}
            >
              {f.shotUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a signed, changing storage link
                <img src={f.shotUrl} alt={`The form for ${f.title} at ${f.company}, ${since(f.shotAt, now)}`} className="size-full object-cover object-top" />
              ) : (
                <span className="flex size-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  {view.running ? "Screenshot in a few seconds…" : "No screenshot: the runner is off."}
                </span>
              )}
            </button>
            <div className="flex min-w-0 flex-col gap-1">
              <Link href={`/app/applications/${f.applicationId}`} className="truncate text-sm font-medium hover:underline">{f.title}</Link>
              <span className="truncate text-xs text-muted-foreground">{f.company}</span>
              <div className="flex items-center justify-between gap-2">
                <Badge className={f.step === "waiting_for_you" ? TONE_BADGE.warning : TONE_BADGE.info}>{APPLY_STEP_TITLE[f.step] ?? f.step}</Badge>
                {f.shotAt && <span className="text-xs text-muted-foreground">{since(f.shotAt, now)}</span>}
              </div>
              {f.note && <p className="line-clamp-2 text-xs text-muted-foreground" title={f.note}>{f.note}</p>}
              {f.step === "waiting_for_you" && view.running && (
                <RemoteFields
                  applicationId={f.applicationId}
                  fields={view.left[f.applicationId]?.fields ?? []}
                  sentAt={view.given[f.applicationId]?.at}
                  leftAt={view.left[f.applicationId]?.at}
                  now={now}
                  onView={setView}
                />
              )}
              <FormControls form={f} view={view} onView={setView} now={now} />
            </div>
          </article>
        ))}
      </div>
      {zoomed?.shotUrl && (
        <div role="dialog" aria-label={`${zoomed.title} at ${zoomed.company}`} className="fixed inset-0 z-50 flex flex-col bg-black/90 p-2" onClick={() => setBig(null)}>
          <div className="flex items-center justify-between p-2 text-sm text-white">
            <span className="truncate">{zoomed.title} at {zoomed.company} · {since(zoomed.shotAt, now)}</span>
            <button type="button" className="rounded px-2 py-1 hover:bg-white/10" onClick={() => setBig(null)}>Close</button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed, changing storage link */}
          <img src={zoomed.shotUrl} alt="" className="min-h-0 flex-1 object-contain" />
        </div>
      )}
    </section>
  );
}
