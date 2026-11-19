"use client";

import { Check, Copy } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, type FormMessageState } from "../../_components/form-message";
import { sendForwardingTestAction } from "./actions";

/** The forwarding address with a Copy button. */
export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="rounded-md bg-muted px-2 py-1 text-sm break-all">{address}</code>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(address).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** Sends the forwarding test to the application email. */
export function SendTestButton({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<FormMessageState, FormData>(sendForwardingTestAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" variant="outline" disabled={disabled || pending} title={disabled ? "Verify your application email on Profile first." : undefined}>
        {pending ? "Sending…" : "Send a test"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
