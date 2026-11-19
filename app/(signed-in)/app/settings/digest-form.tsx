"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { setDigestAction, type DigestState } from "./actions";

/** Every quarter hour of the day, as "HH:MM" with its label ("8:00 AM"). */
const TIMES = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return { value, label: `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}` };
});

/** The daily email: on or off, what time, and in which time zone. */
export function DigestForm({ digest, time, timezone, zones }: { digest: "daily" | "off"; time: string; timezone: string; zones: string[] }) {
  const [state, action, pending] = useActionState<DigestState, FormData>(setDigestAction, {});
  const options = zones.includes(timezone) ? zones : [timezone, ...zones];
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="digest" className="text-sm font-medium">Daily email</label>
          <NativeSelect id="digest" name="digest" defaultValue={digest}>
            <NativeSelectOption value="daily">On</NativeSelectOption>
            <NativeSelectOption value="off">Off</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="digest-time" className="text-sm font-medium">At</label>
          <NativeSelect id="digest-time" name="digest_time" defaultValue={time}>
            {TIMES.map((t) => (
              <NativeSelectOption key={t.value} value={t.value}>{t.label}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="digest-timezone" className="text-sm font-medium">Time zone</label>
          <NativeSelect id="digest-timezone" name="timezone" defaultValue={timezone} className="max-w-64">
            {options.map((z) => (
              <NativeSelectOption key={z} value={z}>{z.replaceAll("_", " ")}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      </div>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      {state.saved && !state.error && <p role="status" className="text-sm text-muted-foreground">Saved.</p>}
    </form>
  );
}
