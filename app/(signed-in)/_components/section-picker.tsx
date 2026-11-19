"use client";

import { useRouter } from "next/navigation";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/shared/cn";

/** One section a page is in: where it is, its name, and a count shown beside it. */
export type Section = { href: string; label: string; count?: number };

/**
 * A page's sections as a list to pick from, for a phone, where a row of tabs runs off the screen. Desktop keeps the
 * tabs (hide this there with `className`). Picking one goes to it.
 */
export function SectionPicker({ sections, current, label, className }: { sections: Section[]; current: string; label: string; className?: string }) {
  const router = useRouter();
  return (
    <NativeSelect aria-label={label} value={current} onChange={(e) => router.push(e.target.value)} className={cn("w-full", className)}>
      {sections.map((s) => (
        <NativeSelectOption key={s.href} value={s.href}>
          {s.count != null ? `${s.label} (${s.count})` : s.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
