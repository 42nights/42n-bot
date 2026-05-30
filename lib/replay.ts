"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EventRow } from "@/lib/narration";

export type ReplaySpeed = 1 | 2 | 4 | 10;

export type ReplayState = {
  playhead: number;
  duration: number;
  playing: boolean;
  speed: ReplaySpeed;
  visibleEvents: EventRow[];
  play(): void;
  pause(): void;
  setPlayhead(ms: number): void;
  setSpeed(s: ReplaySpeed): void;
};

const TICK_MS = 100;
const DEAD_AIR_THRESHOLD_MS = 2_000;

export function useReplay(events: EventRow[]): ReplayState {
  const startTs = events.length > 0 ? events[0].ts : 0;
  const endTs = events.length > 0 ? events[events.length - 1].ts : 0;
  const duration = Math.max(0, endTs - startTs);

  const [playhead, setPlayheadState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<ReplaySpeed>(1);

  // Keep refs for the interval callback to avoid stale closure issues
  const playheadRef = useRef(playhead);
  const speedRef = useRef(speed);
  const durationRef = useRef(duration);
  const eventsRef = useRef(events);

  useEffect(() => { playheadRef.current = playhead; }, [playhead]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { eventsRef.current = events; }, [events]);

  useEffect(() => {
    if (!playing) return;

    const id = setInterval(() => {
      const currentPlayhead = playheadRef.current;
      const currentSpeed = speedRef.current;
      const currentDuration = durationRef.current;
      const currentEvents = eventsRef.current;
      const currentStartTs = currentEvents.length > 0 ? currentEvents[0].ts : 0;

      if (currentPlayhead >= currentDuration) {
        setPlaying(false);
        return;
      }

      const absoluteNow = currentStartTs + currentPlayhead;

      // Find the next event after current position
      const nextEvent = currentEvents.find((e) => e.ts > absoluteNow);

      let nextPlayhead = currentPlayhead + currentSpeed * TICK_MS;

      // Skip dead air: if the gap to the next event is > threshold, jump there
      if (nextEvent) {
        const gap = nextEvent.ts - absoluteNow;
        if (gap > DEAD_AIR_THRESHOLD_MS) {
          nextPlayhead = nextEvent.ts - currentStartTs;
        }
      }

      const clamped = Math.min(nextPlayhead, currentDuration);
      setPlayheadState(clamped);
      playheadRef.current = clamped;

      if (clamped >= currentDuration) {
        setPlaying(false);
      }
    }, TICK_MS);

    return () => clearInterval(id);
  }, [playing]);

  const visibleEvents = events.filter((e) => e.ts <= startTs + playhead);

  const play = useCallback(() => {
    if (playheadRef.current >= durationRef.current) {
      setPlayheadState(0);
      playheadRef.current = 0;
    }
    setPlaying(true);
  }, []);

  const pause = useCallback(() => setPlaying(false), []);

  const setPlayhead = useCallback((ms: number) => {
    const clamped = Math.max(0, Math.min(ms, durationRef.current));
    setPlayheadState(clamped);
    playheadRef.current = clamped;
  }, []);

  const setSpeed = useCallback((s: ReplaySpeed) => {
    setSpeedState(s);
    speedRef.current = s;
  }, []);

  return {
    playhead,
    duration,
    playing,
    speed,
    visibleEvents,
    play,
    pause,
    setPlayhead,
    setSpeed,
  };
}
