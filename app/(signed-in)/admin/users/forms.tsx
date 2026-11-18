"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inviteAction, type InviteState } from "./actions";

/** Invites someone by email. */
export function InviteForm() {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input name="email" type="email" placeholder="name@example.com" aria-label="Email to invite" required className="sm:max-w-xs" />
        <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send invite"}</Button>
      </div>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-success">{state.ok}</p>}
    </form>
  );
}

/** An Invite button for one address (a request to join, or a fresh link for someone who hasn't joined yet). */
export function InviteButton({ email, label = "Invite", variant = "default" }: { email: string; label?: string; variant?: "default" | "outline" }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction, {});
  return (
    <form action={action} className="inline-flex flex-col items-end">
      <input type="hidden" name="email" value={email} />
      <Button type="submit" size="sm" variant={variant} disabled={pending}>{pending ? "Sending…" : state.ok ? "Sent" : label}</Button>
      {state.error && <span role="alert" className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
