import { NextRequest, NextResponse } from "next/server";
import { ensureLocalClone } from "@/src/repo-clone";
import { requireAdmin } from "@/src/shared/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  // ensureLocalClone throws on serverless (no git binary / writable FS) rather
  // than returning {ok:false}; catch it so the client gets a clean error body
  // instead of an empty 500.
  try {
    const result = await ensureLocalClone(id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
