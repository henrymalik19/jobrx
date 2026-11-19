"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/shared/cn";

/** Whether a key press belongs to something you're typing in (or a key combination), not the page. */
function typing(e: KeyboardEvent): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return true;
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !!el.closest("[role=listbox],[role=menu],dialog[open]"));
}

/**
 * Previous and next in the To do lane you opened this application from, with where you are in it;
 * ← and → step through it and Esc goes back to the list, unless you're typing in a field.
 */
export function LaneNav({ prev, next, back, index, total, label }: {
  prev: string | null;
  next: string | null;
  back: string;
  /** Your place in the lane (from 0), or null once this one has left it. */
  index: number | null;
  total: number;
  label: string;
}) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const to = e.key === "ArrowLeft" ? prev : e.key === "ArrowRight" ? next : e.key === "Escape" ? back : null;
      if (!to) return;
      e.preventDefault();
      router.push(to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, back, router]);
  // Fetched ahead, so stepping is quick.
  useEffect(() => {
    for (const to of [prev, next]) if (to) router.prefetch(to);
  }, [prev, next, router]);

  const arrow = (to: string | null, name: string, icon: ReactNode) =>
    to ? (
      <Link href={to} aria-label={name} title={`${name} (${name === "Previous" ? "←" : "→"})`} className={buttonVariants({ variant: "outline", size: "icon-sm" })}>
        {icon}
      </Link>
    ) : (
      <span aria-disabled className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "pointer-events-none opacity-40")}>{icon}</span>
    );

  return (
    <nav aria-label={`Step through ${label}`} className="flex items-center gap-1.5">
      {arrow(prev, "Previous", <ChevronLeft />)}
      <span className="min-w-14 text-center text-sm tabular-nums text-muted-foreground" aria-live="polite">
        {index != null ? `${index + 1} of ${total}` : `${total} left`}
      </span>
      {arrow(next, "Next", <ChevronRight />)}
    </nav>
  );
}
