import { NextRequest, NextResponse } from "next/server";
import { runImplementer } from "@/src/coordinator/implementer";
import { runReviewer } from "@/src/coordinator/reviewer";
import { requireAdmin } from "@/src/shared/auth";
import { botConfig } from "@/bot.config";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as {
    kind?: "implementer" | "reviewer";
    owner?: string;
    repo?: string;
    issueNumber?: number;
    issueTitle?: string;
    issueBody?: string;
  };
  const kind = body.kind ?? "reviewer";
  const repoDir = process.env.REPO_DIR;
  if (!repoDir) {
    return NextResponse.json({ error: "REPO_DIR not set" }, { status: 400 });
  }
  const cfg =
    botConfig.repos.find(
      (r) => r.owner === body.owner && r.name === body.repo,
    ) ?? botConfig.repos[0];

  if (kind === "implementer") {
    if (!body.issueNumber || !body.issueTitle) {
      return NextResponse.json(
        { error: "issueNumber + issueTitle required" },
        { status: 400 },
      );
    }
    const out = await runImplementer({
      repoDir,
      owner: cfg.owner,
      repo: cfg.name,
      baseBranch: cfg.defaultBranch,
      issue: {
        number: body.issueNumber,
        title: body.issueTitle,
        body: body.issueBody ?? "",
        labels: [],
      },
    });
    return NextResponse.json(out);
  } else {
    const out = await runReviewer({
      repoDir,
      owner: cfg.owner,
      repo: cfg.name,
    });
    return NextResponse.json(out);
  }
}
