import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { db } from "@/src/db";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  ensureSchema();
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n))
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  const run = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(n) as
    | { status: string }
    | undefined;
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
  db.prepare(
    `UPDATE runs SET status='abandoned', error_message='cancelled via dashboard', finished_at=? WHERE id=?`,
  ).run(Date.now(), n);
  return NextResponse.json({ ok: true });
}
