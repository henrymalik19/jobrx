"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/cn";
import { FormMessage, type FormMessageState } from "./form-message";

/**
 * A form bound to a server action that reports back a {@link FormMessageState}:
 * shows a pending submit button and the success or error line.
 */
export function ActionForm({
  action,
  submitLabel,
  className,
  children,
  extraButtons,
  stickySubmit = false,
}: {
  action: (prev: FormMessageState, formData: FormData) => Promise<FormMessageState>;
  submitLabel: string;
  className?: string;
  children: ReactNode;
  /** Buttons shown next to submit (e.g. a delete button using formAction). */
  extraButtons?: ReactNode;
  /** On a phone, the Save row stays at the bottom of the screen while the form scrolls (a long form). */
  stickySubmit?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormMessageState, FormData>(action, {});
  return (
    <form action={formAction} className={cn("flex flex-col gap-3", className)}>
      {children}
      <div
        className={cn(
          "flex flex-wrap items-center gap-3",
          stickySubmit && "max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-4 max-md:border-t max-md:bg-card max-md:px-4 max-md:py-3",
        )}
      >
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        {extraButtons}
        <FormMessage state={state} />
      </div>
    </form>
  );
}
