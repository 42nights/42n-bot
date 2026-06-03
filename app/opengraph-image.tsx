import { ImageResponse } from "next/og";

export const alt = "Otis — AI engineer at 42nights";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ACCENT = "#ff5a69";
const NAME = "Otis";
const TAGLINE = "The AI engineer — reads issues, writes PRs, asks before anything risky.";
const URL = "otis-two.vercel.app";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0706",
          padding: 80,
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -220,
            right: -160,
            width: 640,
            height: 640,
            display: "flex",
            background: `radial-gradient(circle, ${ACCENT}40, transparent 70%)`,
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            color: "rgba(255,255,255,0.55)",
            fontSize: 26,
            letterSpacing: "0.3em",
            fontWeight: 600,
          }}
        >
          <div style={{ width: 14, height: 14, borderRadius: 99, background: ACCENT, display: "flex" }} />
          42NIGHTS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 128, fontWeight: 800, color: "#fff", letterSpacing: "-0.03em" }}>
            {NAME}
          </div>
          <div style={{ display: "flex", fontSize: 40, color: "rgba(255,255,255,0.72)", maxWidth: 960, lineHeight: 1.3 }}>
            {TAGLINE}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 26, color: "rgba(255,255,255,0.5)" }}>
          <div style={{ display: "flex" }}>{URL}</div>
          <div
            style={{
              display: "flex",
              padding: "10px 22px",
              borderRadius: 99,
              border: `1px solid ${ACCENT}`,
              color: ACCENT,
              fontSize: 22,
              letterSpacing: "0.18em",
              fontWeight: 600,
            }}
          >
            PREVIEW
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
