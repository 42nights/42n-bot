import { NextRequest } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { db } from "@/src/db";

export const runtime = "nodejs";

const TERMINAL = new Set([
  "pr-opened",
  "succeeded",
  "needs-review",
  "failed",
  "abandoned",
]);

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  ensureSchema();
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isFinite(runId)) {
    return new Response("bad id", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const safeEnqueue = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          closed = true;
        }
      };
      const send = (data: unknown) =>
        safeEnqueue(`data: ${JSON.stringify(data)}\n\n`);

      const existing = db
        .prepare(`SELECT * FROM events WHERE run_id=? ORDER BY id`)
        .all(runId) as Array<{ id: number }>;
      for (const e of existing) send(e);
      let lastId = existing.at(-1)?.id ?? 0;

      const tick = () => {
        if (closed) return;
        try {
          const fresh = db
            .prepare(
              `SELECT * FROM events WHERE run_id=? AND id > ? ORDER BY id`,
            )
            .all(runId, lastId) as Array<{ id: number }>;
          for (const e of fresh) {
            send(e);
            lastId = e.id;
          }
          const run = db
            .prepare(`SELECT status FROM runs WHERE id = ?`)
            .get(runId) as { status?: string } | undefined;
          // B12: close as soon as the run is terminal — no 500ms delay
          // waiting for an empty next tick. We've already drained `fresh`
          // above, so any final events landed in the same transaction as
          // the terminal status flip are still sent.
          if (run && TERMINAL.has(run.status ?? "")) {
            safeEnqueue(`event: end\ndata: done\n\n`);
            closed = true;
            try {
              controller.close();
            } catch {/* already closed */}
            clearInterval(timer);
            clearInterval(heartbeat);
          }
        } catch {
          /* per-tick errors are non-fatal */
        }
      };

      const timer = setInterval(tick, 500);

      // B4: keepalive comment every 30s. Cloudflare, nginx, and friends close
      // idle SSE streams around the ~100s mark; a 30s heartbeat is well under
      // every reasonable proxy timeout.
      const heartbeat = setInterval(() => safeEnqueue(`: keepalive\n\n`), 30_000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(timer);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {/* already closed */}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
