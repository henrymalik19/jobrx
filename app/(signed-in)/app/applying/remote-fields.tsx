"use client";

// The boxes still empty on a form the runner has open and waiting for you, to answer from here (your phone, say):
// the runner types your answers into the form in Chrome, keeps them for a retry, and waits for you again.
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { fillFieldsAction, type ControlResult, type LiveView } from "./actions";

type Field = { key: string; label: string; kind: string; options: string[] };

/**
 * One box per empty field (a list where the form offers choices), and Fill it in. While the runner types them in,
 * it says so; afterwards the runner's note says what took.
 */
export function RemoteFields({ applicationId, fields, sentAt, leftAt, now, onView }: {
  applicationId: string;
  fields: Field[];
  /** When your last answers for this form were sent, and when the runner last said what's empty. */
  sentAt?: string | null;
  leftAt?: string | null;
  /** The time now (from the last refresh). */
  now: number;
  onView?: (v: LiveView) => void;
}) {
  const id = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (fields.length === 0) return null;
  // Sent a moment ago and the runner hasn't said what's empty since (it does once it has typed them in).
  const typing = !!sentAt && (!leftAt || leftAt < sentAt) && now - new Date(sentAt).getTime() < 60_000;
  const submit = () =>
    start(async () => {
      setError(null);
      const given = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()).map(([k, v]) => [k, [v.trim()]]));
      const result: ControlResult = await fillFieldsAction(applicationId, given).catch(() => ({ error: "That didn't go through; try again." }));
      if (result.error) return setError(result.error);
      if (result.view) onView?.(result.view);
    });
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/5 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-xs font-medium">Empty on the form: answer here and the runner types it in</p>
      {fields.map((f, i) => {
        const inputId = `${id}-${i}`;
        return (
          <div key={f.key} className="flex flex-col gap-1">
            <label htmlFor={inputId} className="text-xs">{f.label}</label>
            {f.options.length > 0 && (f.kind === "select" || f.kind === "multiselect") ? (
              <NativeSelect id={inputId} size="sm" value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
                <NativeSelectOption value="">Pick one</NativeSelectOption>
                {f.options.map((o) => <NativeSelectOption key={o} value={o}>{o}</NativeSelectOption>)}
              </NativeSelect>
            ) : (
              <Input id={inputId} className="h-8" value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || typing || !Object.values(values).some((v) => v.trim())}>
          {pending || typing ? "Typing it in…" : "Fill it in"}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </form>
  );
}
