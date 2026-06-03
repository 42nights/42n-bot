import { NextRequest, NextResponse } from "next/server";
import {
  deleteCron,
  getCron,
  listCronRuns,
  updateCron,
  type CronAction,
} from "@/src/cron/store";
import { withId, withIds } from "@/src/db/serialize";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const cron = await getCron(id);
  if (!cron) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    cron: withId(cron),
    history: withIds(await listCronRuns(cron._id, 50)),
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
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
    const updated = await updateCron(id, body);
    if (!updated)
      return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, cron: withId(updated) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const ok = await deleteCron(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
