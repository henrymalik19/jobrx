"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requestAccessAction, type RequestState } from "./actions";

/** Name, email and an optional note; then a thank-you in its place. */
export function RequestForm() {
  const [state, action, pending] = useActionState<RequestState, FormData>(requestAccessAction, {});
  if (state.sent) {
    return (
      <p role="status" className="text-sm">
        Thanks! Your request is in. If you&apos;re invited, you&apos;ll get an email from Jobrx with a link to set up your account.
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" autoComplete="name" defaultValue={state.values?.name} required maxLength={120} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" defaultValue={state.values?.email} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="note">What are you looking for? <span className="text-muted-foreground">(optional)</span></Label>
        <Textarea id="note" name="note" rows={3} maxLength={1000} defaultValue={state.values?.note} placeholder="The roles you're after, or how you heard about Jobrx" />
      </div>
      {/* Left empty by people; bots fill every field. */}
      <div aria-hidden className="absolute -left-[9999px]">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Request access"}</Button>
    </form>
  );
}
