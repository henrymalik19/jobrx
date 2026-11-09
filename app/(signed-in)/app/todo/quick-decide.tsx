"use client";

import { Check, X } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { quickApproveAction, quickSkipAction } from "./actions";

/**
 * Approve and Skip right in a To do row, without opening the application. Skip asks once more (a second
 * click) and skips without a reason or rule; open the application to give one.
 */
export function QuickDecide({ applicationId, canApprove }: { applicationId: string; canApprove: boolean }) {
  const [pending, startTransition] = useTransition();
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (action: (id: string) => Promise<string | null>) =>
    startTransition(async () => {
      setError(null);
      const err = await action(applicationId);
      if (err) setError(err);
    });
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-1">
        {canApprove && (
          <Button
            type="button"
            size="icon"
            variant="outline"
            disabled={pending}
            title="Approve: the apply runner sends it"
            aria-label="Approve"
            className="size-8 text-success hover:bg-success/10 hover:text-success"
            onClick={() => run(quickApproveAction)}
          >
            <Check />
          </Button>
        )}
        {confirmSkip ? (
          <>
            <Button type="button" size="sm" variant="destructive" disabled={pending} className="h-8" onClick={() => run(quickSkipAction)}>
              {pending ? "Skipping…" : "Skip it"}
            </Button>
            <Button type="button" size="icon" variant="ghost" disabled={pending} aria-label="Don't skip" className="size-8" onClick={() => setConfirmSkip(false)}>
              <X />
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="icon"
            variant="outline"
            disabled={pending}
            title="Skip this job"
            aria-label="Skip"
            className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmSkip(true)}
          >
            <X />
          </Button>
        )}
      </span>
      {error && <span className="max-w-48 text-right text-xs text-destructive">{error}</span>}
    </span>
  );
}
