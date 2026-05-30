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

  // QA2: hoist the timers so EVERY teardown path (terminal status, client
  // abort, enqueue failure on a dead pipe, and ReadableStream.cancel) clears
  // them. Previously a client that dropped without an abort signal left both
  // intervals running forever — a per-connection leak that compounds under
  // load (e.g. many browser tabs, flaky proxies).
  let timer: ReturnType<typeof setInterval> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const teardown = () => {
    closed = true;
    if (timer) clearInterval(timer);
    if (heartbeat) clearInterval(heartbeat);
    timer = null;
    heartbeat = null;
  };

  const stream = new ReadableStream({
    start(controller) {
      const safeEnqueue = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          // Broken pipe — stop the timers immediately rather than no-opping
          // every 500ms forever.
          teardown();
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
            teardown();
            try {
              controller.close();
            } catch {/* already closed */}
          }
        } catch {
          /* per-tick errors are non-fatal */
        }
      };

      timer = setInterval(tick, 500);

      // B4: keepalive comment every 30s. Cloudflare, nginx, and friends close
      // idle SSE streams around the ~100s mark; a 30s heartbeat is well under
      // every reasonable proxy timeout.
      heartbeat = setInterval(() => safeEnqueue(`: keepalive\n\n`), 30_000);

      req.signal.addEventListener("abort", () => {
        teardown();
        try {
          controller.close();
        } catch {/* already closed */}
      });
    },
    // QA2: ReadableStream.cancel fires when the consumer side is torn down
    // (browser navigates away, fetch aborted) — a path the abort listener
    // doesn't always cover. Clean up here too.
    cancel() {
      teardown();
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
