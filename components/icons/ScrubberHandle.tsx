/**
 * Draggable handle for the time-travel scrubber. Small enough not to obscure
 * the track, bold enough to feel grabbable.
 */
export function ScrubberHandle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 16"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect
        x="0.5"
        y="0.5"
        width="11"
        height="15"
        rx="2"
        fill="var(--accent)"
        stroke="var(--accent-fg)"
        strokeOpacity="0.2"
      />
      <line x1="4.5" y1="4" x2="4.5" y2="12" stroke="var(--accent-fg)" strokeOpacity="0.5" />
      <line x1="7.5" y1="4" x2="7.5" y2="12" stroke="var(--accent-fg)" strokeOpacity="0.5" />
    </svg>
  );
}
