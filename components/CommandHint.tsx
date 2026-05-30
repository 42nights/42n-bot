"use client";

import { useEffect, useState } from "react";

/**
 * Tiny "⌘K" chip in the top bar. Opens the command palette via a window
 * event the palette itself listens for. Detects the platform for ⌘ vs ctrl.
 */
export function CommandHint() {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.userAgent));
  }, []);
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent("otis:open-palette"))}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-[var(--bg-elev)] text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors"
      aria-label="Open command palette"
    >
      <kbd className="font-mono text-[10px]">{isMac ? "⌘" : "Ctrl"}</kbd>
      <kbd className="font-mono text-[10px]">K</kbd>
    </button>
  );
}
