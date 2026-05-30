import { cn } from "@/lib/utils";

/**
 * The single most important "alive" signal in the product. Pulses with a
 * breathing aura when Otis is working; sits still and dim when idle.
 *
 * The breathing animation lives in globals.css (`@keyframes otis-breathe`)
 * so it can be reused without re-mounting motion runtime here.
 */
export function LiveDot({
  active,
  className,
  size = 8,
}: {
  active: boolean;
  className?: string;
  size?: number;
}) {
  return (
    <span
      className={cn(
        "inline-block rounded-full",
        active ? "otis-live-dot" : "",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: active ? "var(--accent)" : "var(--border-strong)",
      }}
      aria-hidden
    />
  );
}
