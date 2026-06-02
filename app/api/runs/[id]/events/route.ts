import { NextRequest } from "next/server";
import { getRun } from "@/src/db/ops/runs";
import { listEventsByRunAfterCursor } from "@/src/db/ops/events";

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
  const { id } = await ctx.params;
  if (!id) return new Response("bad id", { status: 400 });

  const run = await getRun(id);
  if (!run) return new Response("run not found", { status: 404 });

  const encoder = new TextEncoder();
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
          teardown();
        }
      };
      const send = (data: unknown) =>
        safeEnqueue(`data: ${JSON.stringify(data)}\n\n`);

      // Cursor: track the highest _creationTime seen so we only fetch new rows.
      let lastCreationTime: number | undefined = undefined;

      const tick = async () => {
        if (closed) return;
        try {
          const fresh = await listEventsByRunAfterCursor(id, lastCreationTime);
          for (const e of fresh) {
            send(e);
            lastCreationTime = Math.max(
              lastCreationTime ?? 0,
              e._creationTime,
            );
          }
          const current = await getRun(id);
          if (current && TERMINAL.has(current.status)) {
            safeEnqueue(`event: end\ndata: done\n\n`);
            teardown();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        } catch {
          /* per-tick errors are non-fatal */
        }
      };

      // Send the initial batch immediately, then poll.
      tick();
      timer = setInterval(() => { tick().catch(() => {}); }, 500);
      heartbeat = setInterval(() => safeEnqueue(`: keepalive\n\n`), 30_000);

      req.signal.addEventListener("abort", () => {
        teardown();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
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
