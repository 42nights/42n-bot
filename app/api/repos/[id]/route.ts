import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import {
  deleteConnectedRepo,
  getConnectedRepo,
  updateConnectedRepo,
} from "@/src/repo-store";

export const runtime = "nodejs";

function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  ensureSchema();
  const { id } = await ctx.params;
  const n = parseId(id);
  if (!n) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as {
    enabled?: boolean;
    repoDir?: string | null;
  };
  const repo = updateConnectedRepo(n, {
    enabled: body.enabled,
    repo_dir: body.repoDir,
  });
  if (!repo) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, repo });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  ensureSchema();
  const { id } = await ctx.params;
  const n = parseId(id);
  if (!n) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const ok = deleteConnectedRepo(n);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  ensureSchema();
  const { id } = await ctx.params;
  const n = parseId(id);
  if (!n) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const repo = getConnectedRepo(n);
  if (!repo) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ repo });
}
