"use client";

import { Check, Loader2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { quickApproveAction, quickSkipAction } from "./actions";

type Decision = "approved" | "skipped";

/**
 * Approve and Skip right in a To do row, without opening the application. Skip asks once more (a second
 * click) and skips without a reason or rule; open the application to give one.
 *
 * The row answers at once: it shows the decision (and its row dims, `data-decided`) while the server saves it
 * and the list reloads, and goes back to the buttons with the error if it couldn't be saved.
 */
export function QuickDecide({ applicationId, canApprove }: { applicationId: string; canApprove: boolean }) {
  const [, startTransition] = useTransition();
  const [decided, setDecided] = useState<Decision | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (decision: Decision, action: (id: string) => Promise<string | null>) => {
    setError(null);
    setDecided(decision);
    startTransition(async () => {
      const err = await action(applicationId).catch(() => "That didn't go through; try again.");
      if (err) {
        setDecided(null);
        setConfirmSkip(false);
        setError(err);
      }
    });
  };

  if (decided) {
    return (
      <span data-decided={decided} role="status" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {decided === "approved" ? "Approved" : "Skipped"}
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-1">
        {canApprove && (
          <Button
            type="button"
            size="icon"
            variant="outline"
            title="Approve: the apply runner sends it"
            aria-label="Approve"
            className="size-8 text-success hover:bg-success/10 hover:text-success"
            onClick={() => run("approved", quickApproveAction)}
          >
            <Check />
          </Button>
        )}
        {confirmSkip ? (
          <>
            <Button type="button" size="sm" variant="destructive" className="h-8" onClick={() => run("skipped", quickSkipAction)}>
              Skip it
            </Button>
            <Button type="button" size="icon" variant="ghost" aria-label="Don't skip" className="size-8" onClick={() => setConfirmSkip(false)}>
              <X />
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="icon"
            variant="outline"
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
