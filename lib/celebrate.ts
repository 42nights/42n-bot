"use client";

import confetti from "canvas-confetti";

/**
 * One-shot reward moments. Used sparingly — the spec says: *single soft burst
 * for a PR open*, not on every event. If the user has sound enabled in
 * settings, also chime the matching sfx (loaded from `/public/sfx/`).
 *
 * Idempotent per moment id — we dedupe on a Set so a re-render doesn't fire
 * the burst twice.
 */
const fired = new Set<string>();

export function celebratePrOpened(prId: number | string) {
  const key = `pr.opened:${prId}`;
  if (fired.has(key)) return;
  fired.add(key);

  confetti({
    particleCount: 65,
    spread: 60,
    startVelocity: 32,
    decay: 0.9,
    scalar: 0.85,
    origin: { x: 0.5, y: 0.35 },
    colors: ["#a8e063", "#7be37b", "#56b870", "#e6f3da"],
  });
  playSfx("pr-opened");
}

export function celebrateFailure(runId: number | string) {
  const key = `failed:${runId}`;
  if (fired.has(key)) return;
  fired.add(key);
  playSfx("failure");
}

export function celebrateNeedsReview(prId: number | string) {
  const key = `needs-review:${prId}`;
  if (fired.has(key)) return;
  fired.add(key);
  playSfx("needs-review");
}

/**
 * Plays a one-shot sound effect if the user has SFX enabled in settings.
 * Silently no-ops when disabled or when the audio file 404s.
 */
function playSfx(name: "pr-opened" | "needs-review" | "failure") {
  try {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("otis.sfx") !== "1") return;
    const audio = new Audio(`/sfx/${name}.wav`);
    audio.volume = 0.4;
    void audio.play().catch(() => {});
  } catch {
    /* swallow */
  }
}
