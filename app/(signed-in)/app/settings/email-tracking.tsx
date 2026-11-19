import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createServiceClient } from "@/server/db/service-client";
import { forwardingStatus } from "@/server/modules/inbound/inbound.service";
import { getApplicationEmail } from "@/server/modules/profile/application-email";
import { ago } from "@/shared/format";
import { serverEnv } from "@/shared/env";
import { CopyAddress, SendTestButton } from "./forwarding";

/** One way to set forwarding up, folded. */
function Way({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted-foreground">{children}</ol>
    </details>
  );
}

/**
 * Email tracking: the person's private forwarding address, how to forward their application email to it, and
 * whether it works (the test came back, the last email arrived, a Gmail confirmation waiting).
 */
export async function EmailTrackingSetting({ userId }: { userId: string }) {
  // The service client for this user's own forwarding address, mail and verification links only.
  const admin = createServiceClient(serverEnv());
  const [status, apply] = await Promise.all([forwardingStatus(admin, userId), getApplicationEmail(admin, userId)]);
  const now = new Date();
  const working = !!status.testArrivedAt || !!status.lastReceivedAt;
  const plus = apply.email && apply.email.includes("+") ? apply.email : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Email tracking <Badge variant={working ? "secondary" : "outline"}>{working ? "Forwarding works" : "Not set up"}</Badge>
        </CardTitle>
        <CardDescription>
          Forward your application email to your own Jobrx address, and replies move your applications by themselves: receipts,
          rejections, interview invites, recruiters writing back. The apply runner reads security codes from it too. Jobrx only reads
          what you forward, never signs in to your mailbox, and forgets forwarded mail after 30 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Your forwarding address</p>
          <CopyAddress address={status.address} />
          <p className="text-xs text-muted-foreground">Private to you. Forward to it; don&apos;t put it on applications.</p>
        </div>

        <p className="text-sm">
          {apply.email ? (
            <>
              Application email: <span className="font-medium">{apply.email}</span>
              {apply.verified ? null : <> (not verified yet: <Link href="/app/profile" className="underline">verify it on Profile</Link>)</>}
            </>
          ) : (
            <>No application email yet: <Link href="/app/profile" className="underline">add it on Profile</Link>.</>
          )}
        </p>

        {status.gmail && (
          <div role="note" className="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
            <p className="font-medium">Gmail wants you to confirm forwarding{status.gmail.from ? ` from ${status.gmail.from}` : ""}</p>
            <p className="text-muted-foreground">
              {status.gmail.link ? (
                <>
                  <a href={status.gmail.link} target="_blank" rel="noreferrer noopener" className="underline">Confirm it in Gmail</a>
                  {status.gmail.code ? <>, or enter the code <span className="font-mono text-foreground">{status.gmail.code}</span> in Gmail&apos;s forwarding settings</> : null}.
                </>
              ) : status.gmail.code ? (
                <>Enter the code <span className="font-mono text-foreground">{status.gmail.code}</span> in Gmail&apos;s forwarding settings.</>
              ) : (
                "Open Gmail's forwarding settings to confirm it."
              )}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Way title="A mailbox just for job hunting (forward everything)">
            <li>In that mailbox&apos;s settings, forward all mail to your forwarding address above. Gmail: Settings, Forwarding and POP/IMAP, Add a forwarding address. Outlook.com: Settings, Mail, Forwarding.</li>
            <li>Gmail sends a confirmation to Jobrx first; it shows up on this card to confirm.</li>
            <li>Use that mailbox&apos;s address as your application email on Profile.</li>
          </Way>
          <Way title="A plus address on your Gmail (you+jobs@gmail.com)">
            <li>
              Use your address with <span className="font-mono">+jobs</span> before the @ as your application email on Profile
              {plus ? ` (yours: ${plus})` : ""}. Mail to it still lands in your inbox.
            </li>
            <li>In Gmail: Settings, Forwarding and POP/IMAP, Add a forwarding address: your forwarding address above. Confirm it from this card when Gmail&apos;s confirmation arrives. Leave forwarding itself off.</li>
            <li>Make a filter: To <span className="font-mono">{plus ?? "you+jobs@gmail.com"}</span>, then Forward it to your forwarding address. Only mail sent to the plus address is forwarded.</li>
          </Way>
          <Way title="Outlook.com or Microsoft 365">
            <li>Outlook.com takes plus addresses too (you+jobs@outlook.com). Use one as your application email on Profile, or a mailbox just for job hunting.</li>
            <li>Settings, Mail, Rules, Add new rule: when it&apos;s sent to that address, Forward to your forwarding address.</li>
            <li>A work or school account may not allow forwarding outside it; use a personal address then.</li>
          </Way>
          <p className="text-xs text-muted-foreground">
            A few application forms don&apos;t take a + in an email address; use your plain address there, and that application isn&apos;t
            tracked. A recruiter writing to your plain address isn&apos;t tracked either: forward that one to your Jobrx address yourself.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <SendTestButton disabled={!apply.verified} />
          <p className="text-sm text-muted-foreground">
            {status.testArrivedAt
              ? `The last test came back ${ago(status.testArrivedAt, now)}: forwarding works.`
              : status.lastReceivedAt
                ? `The last forwarded email arrived ${ago(status.lastReceivedAt, now)}.`
                : "Nothing forwarded yet. Once it's set up, send a test: it should come back within a minute."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
