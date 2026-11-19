"use client";

import { Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormMessage, type FormMessageState } from "../../_components/form-message";
import { addSkillsAction } from "./actions";

/**
 * One box for your skills: typing filters the list below (a moment after you stop), and Add adds what you typed
 * (several at once with commas), when it's new.
 */
export function SkillBox({ q }: { q: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [typed, setTyped] = useState(q);
  const [state, setState] = useState<FormMessageState>({});
  const [adding, startAdding] = useTransition();
  const first = useRef(true);

  // The list filters as you type: the query goes in the address (page 1), so it survives a reload.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      next.delete("page");
      if (typed.trim()) next.set("q", typed.trim());
      else next.delete("q");
      router.replace(`${path}?${next.toString()}`, { scroll: false });
    }, 300);
    return () => clearTimeout(timer);
    // Only the typing moves it; the address it reads is the one at the time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const add = () => {
    if (!typed.trim()) return;
    startAdding(async () => {
      const form = new FormData();
      form.set("names", typed);
      const result = await addSkillsAction({}, form);
      setState(result);
      if (!result.error) setTyped("");
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <form
        className="flex w-full gap-2 sm:w-96"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setState({});
          }}
          placeholder="Find or add a skill"
          aria-label="Find or add a skill"
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={adding || !typed.trim()}>
          <Plus /> {adding ? "Adding…" : "Add"}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">Typing filters your skills; Add adds what you typed (commas for several).</p>
      <FormMessage state={state} />
    </div>
  );
}
