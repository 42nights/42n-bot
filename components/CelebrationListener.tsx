"use client";

import { useEffect, useRef } from "react";
import {
  celebrateFailure,
  celebrateNeedsReview,
  celebratePrOpened,
} from "@/lib/celebrate";

/**
 * Watches a stream of events for the reward-worthy ones and fires the
 * appropriate celebration once. Mount inside any view that already has the
 * events array — currently the session page.
 */
export function CelebrationListener({
  events,
}: {
  events: Array<{ id: number; kind: string; payload_json: string }>;
}) {
  const seen = useRef<Set<number>>(new Set());
  useEffect(() => {
    for (const e of events) {
      if (seen.current.has(e.id)) continue;
      seen.current.add(e.id);
      switch (e.kind) {
        case "pr.opened":
          try {
            const p = JSON.parse(e.payload_json) as { number?: number };
            celebratePrOpened(p.number ?? e.id);
          } catch {
            celebratePrOpened(e.id);
          }
          break;
        case "pr.needs_review":
          try {
            const p = JSON.parse(e.payload_json) as { number?: number };
            celebrateNeedsReview(p.number ?? e.id);
          } catch {
            celebrateNeedsReview(e.id);
          }
          break;
        case "implement.failed":
        case "pr.failed":
        case "claude.budget_exceeded":
          celebrateFailure(e.id);
          break;
      }
    }
  }, [events]);
  return null;
}
