import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/src/db/ops/runs";
import { getRepoByOwnerName } from "@/src/db/ops/repos";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  md: "markdown",
  json: "json",
  css: "css",
  html: "html",
  sh: "shell",
  bash: "shell",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  rs: "rust",
  go: "go",
  rb: "ruby",
  txt: "plaintext",
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "plaintext";
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath)
    return NextResponse.json({ error: "missing path param" }, { status: 400 });

  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  let baseDir: string | null = run.worktree_path ?? null;

  if (!baseDir) {
    const [owner, name] = run.repo.split("/");
    if (owner && name) {
      const repoRow = await getRepoByOwnerName(owner, name);
      if (repoRow?.repo_dir) {
        baseDir = repoRow.repo_dir;
      } else {
        baseDir = path.join(process.cwd(), "data", "repos", `${owner}_${name}`);
      }
    }
  }

  if (!baseDir) {
    return NextResponse.json({ error: "no worktree" }, { status: 404 });
  }

  if (filePath.includes("\0") || filePath.length > 4096) {
    return NextResponse.json({ error: "bad path" }, { status: 400 });
  }
  let realBase: string;
  try {
    realBase = fs.realpathSync(baseDir);
  } catch {
    return NextResponse.json({ error: "worktree gone" }, { status: 410 });
  }
  const requested = path.resolve(realBase, filePath.replace(/^\//, ""));
  let resolved: string;
  try {
    resolved = fs.existsSync(requested)
      ? fs.realpathSync(requested)
      : path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
  } catch {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }
  if (!resolved.startsWith(realBase + path.sep) && resolved !== realBase) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let content: string;
  try {
    content = fs.readFileSync(resolved, "utf8");
  } catch {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }

  return NextResponse.json({ content, language: detectLanguage(filePath) });
}
