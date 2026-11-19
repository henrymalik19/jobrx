"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, type FormMessageState } from "../../_components/form-message";
import { sendEmailVerificationAction } from "./actions";

/** Emails a link to verify the application email. */
export function VerifyEmailButton({ again }: { again: boolean }) {
  const [state, action, pending] = useActionState<FormMessageState, FormData>(sendEmailVerificationAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Sending…" : again ? "Send a new link" : "Send verification link"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
