import { NextRequest, NextResponse } from "next/server";
import { botConfig } from "@/bot.config";
import {
  connectRepo,
  listConnectedRepos,
} from "@/src/repo-store";
import { ensureLocalClone } from "@/src/repo-clone";
import { embeddingsBackend } from "@/src/embeddings";
import { log } from "@/src/shared/logger";
import { withId, withIds } from "@/src/db/serialize";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    connected: withIds(await listConnectedRepos()),
    labels: botConfig.labels,
    verification: {
      maxIterations: botConfig.verification.maxIterations,
      diffMaxLines: botConfig.verification.diffMaxLines,
      criticMinConfidence: botConfig.verification.criticMinConfidence,
    },
    budgets: botConfig.budgets,
    reviewer: botConfig.reviewer,
    githubTokenConfigured: Boolean(process.env.GITHUB_TOKEN),
    embeddingsBackend: embeddingsBackend(),
    openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
}

export async function POST(req: NextRequest) {
  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN is not set on the server" },
      { status: 400 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as {
    owner?: string;
    name?: string;
    repoDir?: string;
  };
  if (!body.owner || !body.name) {
    return NextResponse.json(
      { error: "owner + name required" },
      { status: 400 },
    );
  }
  try {
    const repo = await connectRepo({
      owner: body.owner,
      name: body.name,
      repoDir: body.repoDir ?? null,
    });
    if (!body.repoDir) {
      ensureLocalClone(repo._id).catch((err) =>
        log.warn("clone", `bg clone of repo ${repo._id} failed: ${err}`),
      );
    }
    return NextResponse.json({ ok: true, repo: withId(repo) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status ?? 400;
    return NextResponse.json({ error: message }, { status });
  }
}
