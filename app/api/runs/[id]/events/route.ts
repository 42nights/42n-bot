import { NextRequest } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { db } from "@/src/db";

export const runtime = "nodejs";

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
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      const existing = db
        .prepare(`SELECT * FROM events WHERE run_id=? ORDER BY id`)
        .all(runId) as Array<{ id: number }>;
      for (const e of existing) send(e);
      let lastId = existing.at(-1)?.id ?? 0;

      const tick = () => {
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
          if (
            run &&
            ["pr-opened", "succeeded", "needs-review", "failed", "abandoned"].includes(
              run.status ?? "",
            ) &&
            fresh.length === 0
          ) {
            controller.enqueue(encoder.encode(`event: end\ndata: done\n\n`));
            controller.close();
            clearInterval(timer);
          }
        } catch {
          /* ignore */
        }
      };

      const timer = setInterval(tick, 500);
      req.signal.addEventListener("abort", () => {
        clearInterval(timer);
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
