"use client";

// Client component: uses Monaco editor (browser-only) and useSWR for live file fetching.

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { fetcher } from "@/lib/api-client";
import { formatRelative } from "@/lib/utils";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  { ssr: false, loading: () => <EditorSkeleton /> },
);

type Event = {
  id: string;
  ts: number;
  kind: string;
  payload_json: string;
};

function extractLatestFile(events: Event[]): { path: string; ts: number } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== "implement.tool_use") continue;
    try {
      const p = JSON.parse(e.payload_json);
      const fp = p.input?.file_path ?? p.input?.path;
      if (fp) return { path: fp, ts: e.ts };
    } catch {
      /* ignore */
    }
  }
  return null;
}

function langFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
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
  };
  return map[ext] ?? "plaintext";
}

function EditorSkeleton() {
  return (
    <div className="flex-1 bg-[var(--bg-sunken)] animate-pulse rounded-b-md" />
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <p className="text-sm text-[var(--fg-muted)] italic">{message}</p>
    </div>
  );
}

export function CodeTab({ runId, events }: { runId: string; events: Event[] }) {
  const latest = useMemo(() => extractLatestFile(events), [events]);
  const prevPath = useRef<string | null>(null);
  const [visible, setVisible] = useState(true);

  // Fade transition when file path changes
  useEffect(() => {
    if (!latest) return;
    if (prevPath.current !== null && prevPath.current !== latest.path) {
      setVisible(false);
      const t = setTimeout(() => setVisible(true), 150);
      return () => clearTimeout(t);
    }
    prevPath.current = latest.path;
  }, [latest]);

  const { data, isLoading, error } = useSWR<{ content: string; language: string }>(
    latest ? `/api/sessions/${runId}/file?path=${encodeURIComponent(latest.path)}` : null,
    fetcher,
    { refreshInterval: 4000 },
  );

  if (!latest) {
    return <EmptyState message="Otis hasn't opened any files yet." />;
  }

  const language = data?.language ?? langFromPath(latest.path);
  const content = data?.content ?? "";
  const relativeTime = formatRelative(latest.ts);

  return (
    <div
      className="flex flex-col h-full"
      style={{ transition: "opacity 0.15s ease", opacity: visible ? 1 : 0 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-elev)] shrink-0">
        <span className="font-mono text-[12px] text-[var(--fg)] truncate flex-1">
          {latest.path}
        </span>
        <span className="text-[11px] font-mono text-[var(--fg-subtle)] shrink-0">
          last touched {relativeTime}
        </span>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 relative">
        {isLoading && !data && <EditorSkeleton />}
        {error && (
          <div className="p-4 text-sm text-[var(--fail)]">
            Could not load file: {error.message}
          </div>
        )}
        {!isLoading && !error && (
          <MonacoEditor
            height="100%"
            language={language}
            value={content}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 12,
              fontFamily:
                "var(--font-mono-family), var(--font-geist-mono), 'Geist Mono', ui-monospace, monospace",
              lineNumbers: "on",
              renderLineHighlight: "none",
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
              padding: { top: 12, bottom: 12 },
              wordWrap: "off",
            }}
            theme="vs-dark"
            beforeMount={(monaco) => {
              monaco.editor.defineTheme("42n-dark", {
                base: "vs-dark",
                inherit: true,
                rules: [],
                colors: {
                  "editor.background": "#1c1a1b",
                  "editor.lineHighlightBackground": "#00000000",
                  "editorLineNumber.foreground": "#4a4848",
                  "editorLineNumber.activeForeground": "#8a8585",
                  "editor.selectionBackground": "#3a3535",
                  "editor.inactiveSelectionBackground": "#2a2727",
                },
              });
            }}
            onMount={(_editor, monaco) => {
              monaco.editor.setTheme("42n-dark");
            }}
          />
        )}
      </div>
    </div>
  );
}
