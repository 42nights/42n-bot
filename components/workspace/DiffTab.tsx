"use client";

// Client component: fetches diff from API and renders syntax-highlighted unified diff
// with a per-file file tree and hunk badges.

import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api-client";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

type Verdict = {
  id: string;
  attempt: number;
  pass: number;
  failure_summary: string | null;
  checks_json: string;
};

type DiffFile = {
  path: string;
  added: number;
  removed: number;
  hunks: DiffHunk[];
};

type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

type DiffLine = {
  type: "add" | "remove" | "context" | "hunk";
  content: string;
};

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git")) {
      if (current) files.push(current);
      current = { path: "", added: 0, removed: 0, hunks: [] };
      currentHunk = null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+++ b/")) {
      current.path = line.slice(6);
      continue;
    }
    if (line.startsWith("+++ ")) {
      current.path = line.slice(4);
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("Binary")) {
      continue;
    }
    if (line.startsWith("@@")) {
      currentHunk = { header: line, lines: [] };
      current.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) continue;
    if (line.startsWith("+")) {
      currentHunk.lines.push({ type: "add", content: line.slice(1) });
      current.added++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({ type: "remove", content: line.slice(1) });
      current.removed++;
    } else {
      currentHunk.lines.push({ type: "context", content: line.slice(1) });
    }
  }
  if (current) files.push(current);
  return files.filter((f) => f.path);
}

function getCriticFlags(verdicts: Verdict[]): Set<string> {
  const flags = new Set<string>();
  for (const v of verdicts) {
    try {
      const checks = JSON.parse(v.checks_json) as Array<{ name: string; pass: boolean; message?: string }>;
      for (const c of checks) {
        if (!c.pass && c.name === "critic") {
          // Extract file paths from critic message if any
          const matches = c.message?.match(/\b[\w./-]+\.[a-z]{1,6}\b/g) ?? [];
          for (const m of matches) flags.add(m);
        }
      }
    } catch {
      /* ignore */
    }
  }
  return flags;
}

function HunkBadge({
  file,
  verdicts,
  testFiles,
}: {
  file: DiffFile;
  verdicts: Verdict[];
  testFiles: Set<string>;
}) {
  const criticFlags = getCriticFlags(verdicts);
  const dir = file.path.split("/").slice(0, -1).join("/");
  const covered = Array.from(testFiles).some((t) => t.startsWith(dir) && /test|spec/.test(t));
  const flagged = Array.from(criticFlags).some((f) => f.includes(file.path.split("/").pop() ?? ""));

  if (flagged) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--warn-soft)] text-[var(--warn)] border border-[var(--warn-soft)] font-mono shrink-0">
        ! critic flagged
      </span>
    );
  }
  if (covered) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-soft)] font-mono shrink-0">
        ✓ tests cover this
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-sunken)] text-[var(--fg-subtle)] border border-[var(--border)] font-mono shrink-0">
      ◦ unverified
    </span>
  );
}

function FileTree({
  files,
  selectedIdx,
  onSelect,
  verdicts,
  testFiles,
}: {
  files: DiffFile[];
  selectedIdx: number;
  onSelect: (i: number) => void;
  verdicts: Verdict[];
  testFiles: Set<string>;
}) {
  return (
    <div className="w-56 shrink-0 border-r border-[var(--border)] overflow-y-auto py-2">
      <p className="px-3 text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-2">
        Changed files
      </p>
      {files.map((f, i) => (
        <button
          key={f.path}
          onClick={() => onSelect(i)}
          className={cn(
            "w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12px] font-mono transition-colors",
            i === selectedIdx
              ? "bg-[var(--bg-sunken)] text-[var(--fg)]"
              : "text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--bg-elev)]",
          )}
        >
          <span className="truncate flex-1 min-w-0">{f.path.split("/").pop()}</span>
          <span className="shrink-0 text-[10px] text-[var(--accent)] font-mono">
            +{f.added}
          </span>
          <span className="shrink-0 text-[10px] text-[var(--fail)] font-mono">
            -{f.removed}
          </span>
        </button>
      ))}
    </div>
  );
}

function HunkView({
  hunk,
  collapsed,
  onToggle,
}: {
  hunk: DiffHunk;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-1 text-[11px] font-mono text-[var(--fg-muted)] bg-[var(--bg-sunken)] border-y border-[var(--border)] hover:text-[var(--fg)] transition-colors"
      >
        {hunk.header}
        <span className="ml-2 text-[var(--fg-subtle)]">{collapsed ? "▶ show" : "▼ hide"}</span>
      </button>
      {!collapsed && (
        <div>
          {hunk.lines.map((line, i) => (
            <div
              key={i}
              className={cn(
                "px-3 py-0 font-mono text-[12px] leading-5 whitespace-pre",
                line.type === "add" && "diff-add",
                line.type === "remove" && "diff-del",
                line.type === "context" && "text-[var(--fg-subtle)]",
              )}
            >
              {line.type === "add"
                ? "+"
                : line.type === "remove"
                  ? "-"
                  : " "}
              {line.content}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FileDiff({
  file,
  verdicts,
  testFiles,
}: {
  file: DiffFile;
  verdicts: Verdict[];
  testFiles: Set<string>;
}) {
  const [collapsedHunks, setCollapsedHunks] = useState<Set<number>>(new Set());

  const toggleHunk = (i: number) =>
    setCollapsedHunks((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="sticky top-0 flex items-center gap-3 px-4 py-2 bg-[var(--bg-elev)] border-b border-[var(--border)] z-10">
        <span className="font-mono text-[12px] text-[var(--fg)] flex-1 truncate">{file.path}</span>
        <span className="font-mono text-[11px] text-[var(--accent)]">+{file.added}</span>
        <span className="font-mono text-[11px] text-[var(--fail)]">-{file.removed}</span>
        <HunkBadge file={file} verdicts={verdicts} testFiles={testFiles} />
      </div>
      <div>
        {file.hunks.map((hunk, i) => (
          <HunkView
            key={i}
            hunk={hunk}
            collapsed={collapsedHunks.has(i)}
            onToggle={() => toggleHunk(i)}
          />
        ))}
      </div>
    </div>
  );
}

export function DiffTab({
  runId,
  prUrl,
  verdicts,
  events,
}: {
  runId: string;
  prUrl: string | null;
  verdicts: Verdict[];
  events: Array<{ kind: string; payload_json: string }>;
}) {
  const { data, isLoading, error } = useSWR<{ diff: string }>(
    `/api/runs/${runId}/diff`,
    fetcher,
    { refreshInterval: 5000 },
  );

  const [selectedIdx, setSelectedIdx] = useState(0);

  const { files, testFiles } = useMemo(() => {
    const files = parseDiff(data?.diff ?? "");
    const testFiles = new Set<string>();
    for (const e of events) {
      if (e.kind !== "implement.tool_use") continue;
      try {
        const p = JSON.parse(e.payload_json);
        const fp = p.input?.file_path ?? p.input?.path ?? "";
        if (/test|spec/i.test(fp)) testFiles.add(fp);
      } catch {
        /* ignore */
      }
    }
    return { files, testFiles };
  }, [data, events]);

  // Clamp selected index when files list changes
  const safeIdx = Math.min(selectedIdx, Math.max(0, files.length - 1));

  if (error) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <p className="text-sm text-[var(--fg-muted)] italic">
          {error.message ?? "Failed to load diff."}
        </p>
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <p className="text-sm text-[var(--fg-muted)] italic">Loading diff…</p>
      </div>
    );
  }

  if (!data?.diff || files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3">
        <p className="text-sm text-[var(--fg-muted)] italic">
          Diff will appear once Otis is done editing.
        </p>
        {prUrl && (
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
          >
            Open on GitHub <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <FileTree
        files={files}
        selectedIdx={safeIdx}
        onSelect={setSelectedIdx}
        verdicts={verdicts}
        testFiles={testFiles}
      />
      {files[safeIdx] && (
        <FileDiff
          file={files[safeIdx]}
          verdicts={verdicts}
          testFiles={testFiles}
        />
      )}
    </div>
  );
}
