"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  translate,
  coalesceNarration,
  type EventRow,
  type NarrationLine,
  type TranslateContext,
} from "@/lib/narration";
import { OtisMark } from "./icons/OtisMark";
import { cn } from "@/lib/utils";

const spring = { type: "spring" as const, stiffness: 320, damping: 36, mass: 0.8 };

type TimedLine = NarrationLine & { id: number; ts: number };

/**
 * The conversation pane. Translates raw events into Otis's narration in real
 * time, with a pulsing cursor at the end of the most recent agent line while
 * the run is still in flight.
 *
 * Subscribes to the SSE event stream for the run; falls back to the initial
 * event snapshot if SSE is disabled (e.g. for completed runs).
 */
export function NarrationStream({
  runId,
  initialEvents,
  ctx,
  live = true,
}: {
  runId: number;
  initialEvents: EventRow[];
  ctx: TranslateContext;
  live?: boolean;
}) {
  const [events, setEvents] = useState<EventRow[]>(initialEvents);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!live) return;
    let src: EventSource | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    // QA3 (R3 finding 21): cap reconnects so a persistent error (e.g. the run
    // was deleted and the endpoint 404s) can't loop every 2s forever.
    let attempts = 0;
    const MAX_ATTEMPTS = 6;

    const connect = () => {
      src = new EventSource(`/api/runs/${runId}/events`);
      src.onmessage = (ev) => {
        attempts = 0; // a successful message resets the backoff budget
        try {
          const e = JSON.parse(ev.data) as EventRow;
          setEvents((prev) =>
            prev.some((p) => p.id === e.id) ? prev : [...prev, e],
          );
        } catch {
          /* swallow */
        }
      };
      src.addEventListener("end", () => {
        closed = true;
        src?.close();
      });
      src.onerror = () => {
        if (closed) return;
        src?.close();
        attempts += 1;
        if (attempts > MAX_ATTEMPTS) {
          closed = true;
          return;
        }
        reconnect = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnect) clearTimeout(reconnect);
      src?.close();
    };
  }, [runId, live]);

  const lines: TimedLine[] = useMemo(() => {
    const raw: TimedLine[] = [];
    for (const e of events) {
      const line = translate(e, ctx);
      if (!line) continue;
      raw.push({ ...line, id: e.id, ts: e.ts });
    }
    return coalesceNarration(raw);
  }, [events, ctx]);

  // Mark the LAST agent line as thinking when the run is still live and the
  // line's translator already flagged it as such — that's the breathing cursor.
  const renderedLines = useMemo(() => {
    if (!live) return lines.map((l) => ({ ...l, _isLast: false }));
    let lastAgentIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].kind === "agent") {
        lastAgentIdx = i;
        break;
      }
    }
    return lines.map((l, i) => ({ ...l, _isLast: i === lastAgentIdx }));
  }, [lines, live]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [renderedLines.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {renderedLines.length === 0 ? (
          <div className="text-sm text-[var(--fg-muted)] italic py-10 text-center">
            Otis hasn&apos;t said anything yet.
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {renderedLines.map((l) => (
              <motion.div
                key={l.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={spring}
              >
                <Turn line={l} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function Turn({
  line,
}: {
  line: TimedLine & { _isLast?: boolean };
}) {
  if (line.kind === "system") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-xs",
          line.status === "fail"
            ? "text-[var(--fail)]"
            : line.status === "warn"
              ? "text-[var(--warn)]"
              : line.status === "ok"
                ? "text-[var(--accent)]"
                : "text-[var(--fg-muted)]",
        )}
      >
        <span className="inline-block w-1 h-1 rounded-full bg-current opacity-60" />
        <span>{line.text}</span>
        <span className="ml-auto font-mono text-[10px] text-[var(--fg-subtle)] tabular-nums">
          {formatTs(line.ts)}
        </span>
      </div>
    );
  }
  if (line.kind === "user") {
    return (
      <div className="flex gap-3">
        <div className="w-7 h-7 rounded-full bg-[var(--bg-sunken)] border border-border flex items-center justify-center text-xs">
          You
        </div>
        <div className="flex-1 text-sm text-[var(--fg)]">{line.text}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-3 items-start">
      <OtisMark className="h-7 w-7 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-sm text-[var(--fg)]">Otis</span>
          <span className="font-mono text-[10px] text-[var(--fg-subtle)] tabular-nums">
            {formatTs(line.ts)}
          </span>
        </div>
        <div className="mt-0.5 text-sm text-[var(--fg)] leading-relaxed">
          <MarkdownInline text={line.text} />
          {line._isLast && line.thinking && (
            <span className="otis-thinking-cursor" aria-hidden />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Render `text` with backticks turned into <code>. Cheaper than pulling in a
 * full markdown renderer for the only formatting Otis actually emits.
 */
function MarkdownInline({ text }: { text: string }) {
  const parts: Array<{ code: boolean; v: string }> = [];
  let rest = text;
  while (rest.length > 0) {
    const start = rest.indexOf("`");
    if (start === -1) {
      parts.push({ code: false, v: rest });
      break;
    }
    if (start > 0) parts.push({ code: false, v: rest.slice(0, start) });
    const end = rest.indexOf("`", start + 1);
    if (end === -1) {
      parts.push({ code: false, v: rest.slice(start) });
      break;
    }
    parts.push({ code: true, v: rest.slice(start + 1, end) });
    rest = rest.slice(end + 1);
  }
  return (
    <>
      {parts.map((p, i) =>
        p.code ? (
          <code
            key={i}
            className="font-mono text-[12px] bg-[var(--bg-sunken)] px-1.5 py-0.5 rounded border border-border"
          >
            {p.v}
          </code>
        ) : (
          <span key={i}>{p.v}</span>
        ),
      )}
    </>
  );
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}
