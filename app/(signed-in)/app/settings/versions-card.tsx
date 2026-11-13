import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ownerContext } from "@/server/auth/require-owner";
import { getRunnerStatus, runnerRunning, type RunnerStatus } from "@/server/modules/apply/runner-status";
import { ago } from "@/shared/format";
import { APP_VERSION, shortSha } from "@/shared/version";
import { TONE_BADGE } from "../../_components/status";

const COMMITS = "https://github.com/henrymalik19/jobrx/commit/";

/** A commit as a link to it on GitHub, with its message. */
function Commit({ sha, message }: { sha: string; message: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      {sha ? (
        <a href={`${COMMITS}${sha}`} target="_blank" rel="noreferrer" className="w-fit font-mono text-sm underline-offset-2 hover:underline">{shortSha(sha)}</a>
      ) : (
        <span className="font-mono text-sm">dev</span>
      )}
      {message && <span className="truncate text-sm text-muted-foreground" title={message}>{message}</span>}
    </span>
  );
}

/** Whether a running runner is current: updating by itself, stuck on something, needing a restart, or the app's version. */
function UpdateBadge({ runner, sameAsApp }: { runner: RunnerStatus; sameAsApp: boolean }) {
  if (runner.updateBlocked) {
    return <Badge className={TONE_BADGE.warning} title={`Newer code is on GitHub, but ${runner.updateBlocked}. Pull it yourself, then restart.`}>Can&apos;t update itself</Badge>;
  }
  if (runner.behind && runner.autoUpdate) {
    return <Badge className={TONE_BADGE.info} title="It restarts on the new code once no form is open.">Updating when idle</Badge>;
  }
  if (runner.behind) return <Badge className={TONE_BADGE.warning} title="The code changed since it started.">Restart to update</Badge>;
  if (APP_VERSION.sha && !sameAsApp) {
    return (
      <Badge className={TONE_BADGE.warning} title={runner.autoUpdate ? "It runs other code than the app; it picks up a push within 10 minutes once nothing is open." : "It runs other code than the app."}>
        Not the app&apos;s version
      </Badge>
    );
  }
  return <Badge className={TONE_BADGE.info}>Same as the app</Badge>;
}

/**
 * Versions: the commit the app runs (and when it was deployed), and the one the apply runner on your computer
 * runs, with whether it's running and whether it needs a restart to run the newest code.
 */
export async function VersionsCard() {
  const { db, owner } = await ownerContext();
  const runner = await getRunnerStatus(db, owner.id);
  const now = new Date();
  const running = runner ? runnerRunning(runner, now) : false;
  const sameAsApp = !!runner && !!APP_VERSION.sha && runner.version === APP_VERSION.sha;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Versions</CardTitle>
        <CardDescription>
          The code the app and the apply runner each run. A push to main deploys the app in a few minutes. The runner checks
          GitHub every 10 minutes and, once nothing is open, pulls the new code and restarts itself; one started some other way
          than <code className="rounded bg-muted px-1">pnpm worker:apply</code> needs a restart.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border p-3">
          <span className="text-sm font-medium">App</span>
          <Commit sha={APP_VERSION.sha} message={APP_VERSION.message} />
          {APP_VERSION.builtAt && <span className="text-xs text-muted-foreground">Deployed {ago(APP_VERSION.builtAt, now)}</span>}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border p-3">
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
            Apply runner
            {runner && (
              <Badge className={running ? TONE_BADGE.success : TONE_BADGE.muted}>{running ? "Running" : "Not running"}</Badge>
            )}
            {runner && running && <UpdateBadge runner={runner} sameAsApp={sameAsApp} />}
          </span>
          {runner ? (
            <>
              <Commit sha={runner.version} message={runner.message} />
              <span className="text-xs text-muted-foreground">
                {running ? `Started ${ago(runner.startedAt, now)}` : runner.stoppedAt ? `Stopped ${ago(runner.stoppedAt, now)}` : `Last seen ${ago(runner.seenAt, now)}`}
                {runner.localChanges ? " · with uncommitted changes" : ""}
                {running && runner.autoUpdate ? " · updates itself" : ""}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Not seen yet: it reports here once started.</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
