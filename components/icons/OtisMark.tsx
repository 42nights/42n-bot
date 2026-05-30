/**
 * Otis's monogram. A serif "O" set in a soft circle. Brand-foundation primitive
 * — the entire identity hangs off this single mark. Sized in `em` so it scales
 * with whatever font-size the parent has.
 */
export function OtisMark({
  className,
  title = "Otis",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <circle
        cx="16"
        cy="16"
        r="15.25"
        fill="var(--bg-elev)"
        stroke="var(--border-strong)"
        strokeWidth="0.5"
      />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontFamily="var(--font-serif), Georgia, serif"
        fontSize="20"
        fontWeight="500"
        fill="var(--fg)"
      >
        O
      </text>
    </svg>
  );
}
