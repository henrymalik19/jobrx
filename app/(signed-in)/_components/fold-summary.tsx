import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/cn";

/**
 * The summary of a folded section (`<details className="group">`), with the app's chevron turning as it opens,
 * in place of the browser's own triangle.
 */
export function FoldSummary({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <summary className={cn("flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden", className)}>
      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
    </summary>
  );
}
