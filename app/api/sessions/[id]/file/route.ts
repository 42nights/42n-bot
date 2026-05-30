import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { db } from "@/src/db";
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
  ensureSchema();
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n))
    return NextResponse.json({ error: "bad id" }, { status: 400 });

  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath)
    return NextResponse.json({ error: "missing path param" }, { status: 400 });

  // Resolve the base directory from the run's worktree_path or repo_dir
  const run = db
    .prepare(`SELECT worktree_path, repo FROM runs WHERE id = ?`)
    .get(n) as { worktree_path: string | null; repo: string } | undefined;

  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Determine base dir: worktree_path on the run, else repo_dir from repos table
  let baseDir: string | null = run.worktree_path ?? null;

  if (!baseDir) {
    // Split "owner/name" and look up repo_dir if we store it; otherwise fall back
    const [owner, name] = run.repo.split("/");
    const repoRow = db
      .prepare(`SELECT * FROM repos WHERE owner = ? AND name = ?`)
      .get(owner, name) as Record<string, unknown> | undefined;
    // repos table doesn't have repo_dir column; use a conventional path
    if (repoRow) {
      baseDir = path.join(process.cwd(), "data", "repos", `${owner}_${name}`);
    }
  }

  if (!baseDir) {
    return NextResponse.json({ error: "no worktree" }, { status: 404 });
  }

  // QA1: path-traversal protection with symlink safety.
  // path.resolve() doesn't dereference symlinks — if `baseDir` itself is a
  // symlink (worktree paths often are), `../` escapes via the symlink target
  // were possible. fs.realpathSync resolves all symlinks before comparison.
  // Also reject null-byte injection up front.
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
    // realpath the resolved path too. If it doesn't exist yet, normalize the
    // parent and rejoin so we still get a symlink-resolved comparison.
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
