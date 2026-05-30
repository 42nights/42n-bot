"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Boxes, Check } from "lucide-react";
import { useRepoScope } from "@/lib/repo-scope";
import { cn } from "@/lib/utils";

/**
 * Top-bar dropdown that scopes the entire dashboard to one connected repo
 * (or "All repos"). Lives next to the live-status pill in `<Shell />`.
 *
 * Renders nothing when zero or one repos are connected — single-repo setups
 * don't need the chrome.
 */
export function RepoSelector() {
  const { scope, repos, setScope } = useRepoScope();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (repos.length === 0) return null;

  const label = scope === "all" ? "All repos" : scope;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 h-7 rounded border border-border bg-[var(--bg-elev)] text-xs text-[var(--fg)] hover:bg-[var(--bg-sunken)] transition-colors max-w-[14rem]",
          open && "bg-[var(--bg-sunken)]",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Boxes className="h-3 w-3 text-[var(--fg-muted)] shrink-0" />
        <span className="truncate font-mono text-[11px]">{label}</span>
        <ChevronDown className="h-3 w-3 text-[var(--fg-muted)] shrink-0" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-64 rounded-md border border-border bg-[var(--bg-elev)] shadow-lg z-50 overflow-hidden"
          role="listbox"
        >
          <RepoOption
            label="All repos"
            selected={scope === "all"}
            onSelect={() => {
              setScope("all");
              setOpen(false);
            }}
          />
          <div className="h-px bg-border" />
          {repos.map((r) => {
            const key = `${r.owner}/${r.name}`;
            return (
              <RepoOption
                key={r.id}
                label={key}
                selected={scope === key}
                onSelect={() => {
                  setScope(key);
                  setOpen(false);
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function RepoOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-[var(--bg-sunken)] transition-colors",
        selected ? "text-[var(--fg)]" : "text-[var(--fg-muted)]",
      )}
      role="option"
      aria-selected={selected}
    >
      <span className="font-mono truncate">{label}</span>
      {selected && (
        <Check className="h-3 w-3 text-[var(--accent)] shrink-0 ml-2" />
      )}
    </button>
  );
}
