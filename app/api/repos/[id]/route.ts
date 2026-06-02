import { NextRequest, NextResponse } from "next/server";
import {
  deleteConnectedRepo,
  getConnectedRepo,
  updateConnectedRepo,
} from "@/src/repo-store";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as {
    enabled?: boolean;
    repoDir?: string | null;
  };
  const repo = await updateConnectedRepo(id, {
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
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const ok = await deleteConnectedRepo(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const repo = await getConnectedRepo(id);
  if (!repo) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ repo });
}
