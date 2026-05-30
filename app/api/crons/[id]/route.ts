import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import {
  deleteCron,
  getCron,
  listCronRuns,
  updateCron,
  type CronAction,
} from "@/src/cron/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  ensureSchema();
  const { id } = await ctx.params;
  const cron = getCron(Number(id));
  if (!cron) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    cron,
    history: listCronRuns(cron.id, 50),
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  ensureSchema();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    schedule?: string;
    action?: CronAction;
    payload?: Record<string, unknown>;
    repo?: string | null;
    enabled?: boolean;
  };
  try {
    const updated = updateCron(Number(id), body);
    if (!updated)
      return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, cron: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  ensureSchema();
  const { id } = await ctx.params;
  const ok = deleteCron(Number(id));
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
