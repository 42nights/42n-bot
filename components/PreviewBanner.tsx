// Floating "preview build" marker for the deployed demo links. Self-contained
// inline styles so it renders identically across every app regardless of that
// app's theme tokens. Fixed + pointer-events:none, so it never shifts layout
// or blocks interaction.
export function PreviewBanner() {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2147483647,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 14px",
        borderRadius: 999,
        background: "rgba(18,14,12,0.74)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.14)",
        boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
        fontFamily: "ui-sans-serif,system-ui,-apple-system,sans-serif",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.14em",
        color: "rgba(255,255,255,0.92)",
        whiteSpace: "nowrap",
      }}
    >
      <style>{"@keyframes pvbPulse{0%,100%{opacity:1}50%{opacity:.4}}"}</style>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "#ff5a69",
          boxShadow: "0 0 8px #ff5a69",
          animation: "pvbPulse 2s ease-in-out infinite",
        }}
      />
      PREVIEW
      <span style={{ opacity: 0.5, fontWeight: 500 }}>· 42NIGHTS</span>
    </div>
  );
}
