import { NextRequest, NextResponse } from "next/server";
import { getRun, patchRun } from "@/src/db/ops/runs";
import { requireAdmin } from "@/src/shared/auth";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (
    ["pr-opened", "succeeded", "needs-review", "failed", "abandoned"].includes(
      run.status,
    )
  ) {
    return NextResponse.json(
      { error: `run already terminal: ${run.status}` },
      { status: 409 },
    );
  }
  await patchRun(id, {
    status: "abandoned",
    error_message: "cancelled via dashboard",
    finished_at: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
