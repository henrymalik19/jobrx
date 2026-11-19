import { BadgeCheck, MailWarning } from "lucide-react";
import { createServiceClient } from "@/server/db/service-client";
import { getApplicationEmail } from "@/server/modules/profile/application-email";
import { ago } from "@/shared/format";
import { serverEnv } from "@/shared/env";
import { VerifyEmailButton } from "./verify-email-button";

/**
 * Where the application email stands, under the profile form: verified, or not yet (Jobrx won't put it on
 * applications) with a button to email a link. Nothing when there's no email.
 */
export async function ApplicationEmailStatus({ userId, signInEmail }: { userId: string; signInEmail: string | undefined }) {
  // The service client only to see whether a link is waiting (a table only the server reads), for this user.
  const status = await getApplicationEmail(createServiceClient(serverEnv()), userId);
  if (!status.email) return null;
  if (status.verified) {
    const yours = !!signInEmail && signInEmail.toLowerCase() === status.email.toLowerCase();
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <BadgeCheck className="size-4 text-success" aria-hidden />
        <span><span className="font-medium text-foreground">{status.email}</span> is verified{yours ? " (it's the address you sign in with)" : ""} and goes on your applications.</span>
      </p>
    );
  }
  return (
    <div role="note" className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
      <p className="flex items-start gap-2">
        <MailWarning className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>
          <span className="font-medium">{status.email}</span> isn&apos;t verified yet, so Jobrx won&apos;t put it on applications
          (they wait on you to answer &quot;Email&quot;).{" "}
          {status.linkSentAt ? `A link went out ${ago(status.linkSentAt, new Date())}: open it from that inbox.` : "Send a link to it and open it from that inbox."}
        </span>
      </p>
      <VerifyEmailButton again={!!status.linkSentAt} />
    </div>
  );
}
