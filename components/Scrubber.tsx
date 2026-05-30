"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, ChevronDown } from "lucide-react";
import { ScrubberHandle } from "@/components/icons/ScrubberHandle";
import type { EventRow } from "@/lib/narration";
import type { ReplaySpeed } from "@/lib/replay";
import { cn } from "@/lib/utils";

const PHASE_EVENTS: Record<string, string> = {
  "plan.started": "planning",
  "implement.started": "implementing",
  "verification.started": "verifying",
  "pr.opened": "pr",
};

const SPEEDS: ReplaySpeed[] = [1, 2, 4, 10];

type PhaseMarker = {
  label: string;
  pct: number;
};

export function Scrubber({
  playhead,
  duration,
  playing,
  speed,
  events,
  onPlay,
  onPause,
  onSeek,
  onSpeed,
}: {
  playhead: number;
  duration: number;
  playing: boolean;
  speed: ReplaySpeed;
  events: EventRow[];
  onPlay(): void;
  onPause(): void;
  onSeek(ms: number): void;
  onSpeed(s: ReplaySpeed): void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [speedOpen, setSpeedOpen] = useState(false);

  const pct = duration > 0 ? Math.min(1, playhead / duration) : 0;

  const phaseMarkers: PhaseMarker[] = [];
  if (duration > 0) {
    const startTs = events.length > 0 ? events[0].ts : 0;
    for (const e of events) {
      const label = PHASE_EVENTS[e.kind];
      if (!label) continue;
      const markerPct = (e.ts - startTs) / duration;
      // Avoid duplicates (e.g. multiple plan.started)
      if (!phaseMarkers.some((m) => m.label === label)) {
        phaseMarkers.push({ label, pct: markerPct });
      }
    }
  }

  const seekFromPointer = useCallback(
    (e: PointerEvent | React.PointerEvent) => {
      const track = trackRef.current;
      if (!track || duration === 0) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(ratio * duration);
    },
    [duration, onSeek],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      seekFromPointer(e);
    },
    [seekFromPointer],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      seekFromPointer(e);
    },
    [seekFromPointer],
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  // Close speed dropdown on outside click
  useEffect(() => {
    if (!speedOpen) return;
    const handler = () => setSpeedOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [speedOpen]);

  return (
    <div
      className="h-14 px-4 flex items-center gap-3 bg-[var(--bg-elev)] border-t border-border select-none"
      aria-label="Session replay controls"
    >
      {/* Play / pause */}
      <button
        onClick={playing ? onPause : onPlay}
        className="shrink-0 w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--bg-sunken)] transition-colors text-[var(--fg-muted)] hover:text-[var(--fg)]"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>

      {/* Track area */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* Track */}
        <div
          ref={trackRef}
          className="relative h-1.5 rounded-full bg-[var(--bg-sunken)] cursor-pointer"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          role="slider"
          aria-valuenow={Math.round(playhead / 1000)}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration / 1000)}
          aria-label="Playhead"
          tabIndex={0}
          onKeyDown={(e) => {
            const step = duration * 0.02;
            if (e.key === "ArrowRight") onSeek(Math.min(duration, playhead + step));
            if (e.key === "ArrowLeft") onSeek(Math.max(0, playhead - step));
          }}
        >
          {/* Filled portion */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
            style={{ width: `${pct * 100}%` }}
          />
          {/* Phase tick marks */}
          {phaseMarkers.map((m) => (
            <div
              key={m.label}
              className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-[var(--border)] opacity-60"
              style={{ left: `${m.pct * 100}%` }}
              aria-hidden
            />
          ))}
          {/* Handle — CSS transform for 60fps, no React re-render on move */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none"
            style={{ left: `${pct * 100}%` }}
            aria-hidden
          >
            <ScrubberHandle className="h-4 w-3" />
          </div>
        </div>

        {/* Phase labels under track */}
        {phaseMarkers.length > 0 && (
          <div className="relative h-3">
            {phaseMarkers.map((m) => (
              <span
                key={m.label}
                className="absolute text-[9px] uppercase tracking-[0.08em] text-[var(--fg-subtle)] -translate-x-1/2"
                style={{ left: `${m.pct * 100}%` }}
                aria-hidden
              >
                {m.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Timestamp */}
      <div className="shrink-0 text-xs font-mono tabular-nums text-[var(--fg-muted)] w-24 text-right">
        {fmtMmSs(playhead)} / {fmtMmSs(duration)}
      </div>

      {/* Speed selector */}
      <div className="relative shrink-0">
        <button
          className="flex items-center gap-1 h-7 px-2 rounded text-xs font-mono text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--bg-sunken)] transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            setSpeedOpen((v) => !v);
          }}
          aria-label="Playback speed"
        >
          {speed}x <ChevronDown className="h-3 w-3" />
        </button>
        {speedOpen && (
          <div className="absolute bottom-full right-0 mb-1 bg-[var(--bg-elev)] border border-border rounded shadow-lg overflow-hidden z-50">
            {SPEEDS.map((s) => (
              <button
                key={s}
                className={cn(
                  "block w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-[var(--bg-sunken)] transition-colors",
                  s === speed ? "text-[var(--accent)]" : "text-[var(--fg-muted)]",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onSpeed(s);
                  setSpeedOpen(false);
                }}
              >
                {s}x
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function fmtMmSs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
