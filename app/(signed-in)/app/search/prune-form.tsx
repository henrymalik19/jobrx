"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, type FormMessageState } from "../../_components/form-message";
import { checkSavedJobsAction, pruneSavedJobsAction, type PruneCheck } from "./actions";

/**
 * Re-checks saved jobs against the filters as they are now: first how many no longer pass (and a few of them),
 * then Remove takes them out. Nothing is removed by checking.
 */
export function PruneForm() {
  const [check, setCheck] = useState<PruneCheck>(null);
  const [checking, startCheck] = useTransition();
  const [state, remove, removing] = useActionState<FormMessageState>(async () => {
    const done = await pruneSavedJobsAction();
    setCheck(null);
    return done;
  }, {});
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button type="button" variant="outline" disabled={checking || removing} onClick={() => startCheck(async () => setCheck(await checkSavedJobsAction()))}>
          {checking ? "Checking…" : "Check saved jobs"}
        </Button>
      </div>
      {check && (
        <div role="status" className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
          {check.removed === 0 ? (
            <p>All {check.checked.toLocaleString()} saved jobs still pass your filters. Nothing to remove.</p>
          ) : (
            <>
              <p>
                <span className="font-medium">{check.removed.toLocaleString()}</span> of {check.checked.toLocaleString()} saved jobs no longer
                pass your filters, for example:
              </p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {check.examples.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
              <form action={remove}>
                <Button type="submit" variant="destructive" size="sm" disabled={removing}>
                  {removing ? "Removing…" : `Remove ${check.removed.toLocaleString()}`}
                </Button>
              </form>
            </>
          )}
        </div>
      )}
      <FormMessage state={state} />
    </div>
  );
}
