import { ImageResponse } from "next/og";
import { db } from "@/src/db";
import { ensureSchema } from "@/src/db/migrate";

export const runtime = "nodejs";
export const alt = "Otis session";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STATUS_LABEL: Record<string, string> = {
  "pr-opened": "PR opened",
  succeeded: "Succeeded",
  "needs-review": "Needs review",
  failed: "Failed",
  abandoned: "Abandoned",
  planning: "Planning",
  implementing: "Implementing",
  verifying: "Verifying",
  iterating: "Iterating",
  queued: "Queued",
};

const STATUS_COLOR: Record<string, string> = {
  "pr-opened": "#4ade80",
  succeeded: "#4ade80",
  "needs-review": "#fbbf24",
  failed: "#f87171",
  abandoned: "#71717a",
};

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const n = Number(id);

  let title = `Session #${id}`;
  let status = "unknown";

  if (Number.isFinite(n)) {
    try {
      ensureSchema();
      const run = db.prepare(`SELECT issue_title, status FROM runs WHERE id = ?`).get(n) as
        | { issue_title: string | null; status: string }
        | undefined;
      if (run) {
        title = run.issue_title ?? title;
        status = run.status;
      }
    } catch {
      // DB unavailable at build time — use defaults
    }
  }

  const statusLabel = STATUS_LABEL[status] ?? status;
  const statusColor = STATUS_COLOR[status] ?? "#71717a";

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          background: "#1a1815",
          display: "flex",
          flexDirection: "column",
          padding: "60px 72px",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Top-left: Otis wordmark */}
        <div
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: "#a78bfa",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: "auto",
          }}
        >
          Otis
        </div>

        {/* Center: issue title */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            marginBottom: "auto",
          }}
        >
          <div
            style={{
              fontSize: 14,
              color: "#71717a",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Session replay
          </div>
          <div
            style={{
              fontSize: title.length > 80 ? 36 : title.length > 50 ? 44 : 52,
              fontWeight: 700,
              color: "#f5f5f4",
              lineHeight: 1.15,
              maxWidth: 1000,
            }}
          >
            {title}
          </div>
        </div>

        {/* Bottom row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* Status badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(255,255,255,0.06)",
              border: `1px solid ${statusColor}40`,
              borderRadius: 8,
              padding: "6px 16px",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: statusColor,
              }}
            />
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: statusColor,
                letterSpacing: "0.04em",
              }}
            >
              {statusLabel}
            </span>
          </div>

          {/* 42nights watermark */}
          <div
            style={{
              fontSize: 13,
              color: "#44403c",
              letterSpacing: "0.06em",
            }}
          >
            42nights
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
