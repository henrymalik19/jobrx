"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/cn";

/**
 * The filters past the search box: on a phone, behind a button (with how many are set) that opens them; on
 * desktop, always shown in the row.
 */
export function MoreFilters({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-expanded={open}
        aria-controls="job-filters"
        aria-label={count ? `Filters (${count} set)` : "Filters"}
        className="relative md:hidden"
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal />
        {count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
            {count}
          </span>
        )}
      </Button>
      <div
        id="job-filters"
        className={cn(
          // Desktop: part of the row. Phone: a panel under it, one filter a line.
          "md:contents max-md:flex max-md:w-full max-md:flex-col max-md:gap-2 max-md:[&>[data-slot=native-select-wrapper]]:w-full",
          !open && "max-md:hidden",
        )}
      >
        {children}
      </div>
    </>
  );
}
