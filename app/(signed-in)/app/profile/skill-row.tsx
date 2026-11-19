"use client";

import { Check, Trash2 } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { TableCell, TableRow } from "@/components/ui/table";
import type { FormMessageState } from "../../_components/form-message";
import { removeSkillAction, updateSkillAction } from "./actions";

/** How long a removed skill can be brought back. */
const UNDO_MS = 6000;

/** A skill as the row shows it. */
export type SkillRowData = { skill_id: string; name: string; years_override: number | null; proficiency: string | null };

/**
 * One skill, edited in place: its years (blank = from your jobs) and proficiency save as you change
 * them. The trash button takes it off your list (it stays on the jobs that used it), with a few seconds to undo it
 * (no "are you sure?" first). Duplicates are merged from Find duplicates.
 */
export function SkillRow(props: { s: SkillRowData; years: number | undefined; proficiencies: readonly string[] }) {
  const { s, years, proficiencies } = props;
  const formId = `skill-${s.skill_id}`;
  const form = useRef<HTMLFormElement>(null);
  const [state, save, saving] = useActionState<FormMessageState, FormData>(updateSkillAction, {});
  const submit = () => form.current?.requestSubmit();
  // Removed, with a few seconds to undo: it goes for good when they're up, or when you leave the page.
  const [removed, setRemoved] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeNow = () => {
    pending.current = null;
    const data = new FormData();
    data.set("skill_id", s.skill_id);
    void removeSkillAction(data);
  };
  useEffect(() => () => {
    if (pending.current) {
      clearTimeout(pending.current);
      removeNow();
    }
    // Only on leaving: removeNow reads the skill it was made for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const remove = () => {
    setRemoved(true);
    pending.current = setTimeout(removeNow, UNDO_MS);
  };
  const undo = () => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    setRemoved(false);
  };

  if (removed) {
    return (
      <TableRow>
        <TableCell colSpan={4} className="text-muted-foreground max-md:w-full" role="status">
          Removed {s.name}.{" "}
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={undo}>Undo</Button>
        </TableCell>
      </TableRow>
    );
  }

  // On a phone the row is a card of two lines: the name with its delete button, then years and proficiency.
  return (
    <TableRow>
      <TableCell className="font-medium max-md:order-first max-md:w-[calc(100%-4.5rem)] max-md:min-w-0 max-md:break-words">
        {/* The row's form; the inputs in the other cells belong to it by id. */}
        <form id={formId} ref={form} action={save} className="hidden">
          <input type="hidden" name="skill_id" value={s.skill_id} />
        </form>
        {s.name}
      </TableCell>
      <TableCell className="text-right max-md:order-2 max-md:flex max-md:items-center" data-label="Years">
        <Input
          form={formId}
          name="years_override"
          type="number"
          step="0.5"
          min={0}
          defaultValue={s.years_override ?? ""}
          // Blank means "from your jobs", which shows as the placeholder.
          placeholder={years != null ? String(years) : "—"}
          title={years != null ? `From your jobs: ${years}. Type a number only if that's wrong.` : "Years with this skill"}
          aria-label={`Years with ${s.name}`}
          className="ml-auto h-7 w-20 text-right tabular-nums max-md:ml-0 max-md:w-16"
          onBlur={(e) => {
            if (e.currentTarget.value !== String(s.years_override ?? "")) submit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
      </TableCell>
      {/* "Level" on a phone, where "Proficiency" put it on a line of its own. */}
      <TableCell className="max-md:order-3 max-md:flex max-md:min-w-0 max-md:flex-1 max-md:items-center" data-label="Level">
        <NativeSelect
          form={formId}
          name="proficiency"
          defaultValue={s.proficiency ?? ""}
          aria-label={`Proficiency in ${s.name}`}
          className="h-7 w-32 capitalize max-md:w-auto max-md:min-w-0 max-md:flex-1"
          onChange={submit}
        >
          <NativeSelectOption value="">—</NativeSelectOption>
          {proficiencies.map((x) => <NativeSelectOption key={x} value={x}>{x}</NativeSelectOption>)}
        </NativeSelect>
      </TableCell>
      <TableCell className="w-0 text-right whitespace-nowrap max-md:order-1 max-md:ml-auto max-md:w-auto">
        <span className="mr-1 inline-flex w-4 justify-center text-xs" aria-live="polite">
          {saving ? <span className="text-muted-foreground">…</span> : state.error ? <span className="text-destructive" title={state.error}>!</span> : state.ok ? <Check className="size-4 text-emerald-500" aria-label="Saved" /> : null}
        </span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Remove ${s.name}`}
          title="Remove from your skills (it stays on the jobs that used it)"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={remove}
        >
          <Trash2 />
        </Button>
      </TableCell>
    </TableRow>
  );
}
