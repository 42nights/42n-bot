"use client";

import { useMemo } from "react";

type Event = {
  id: string;
  ts: number;
  kind: string;
  payload_json: string;
};

type Artifact = {
  id: string;
  kind: string;
  bytes?: number;
  created_at?: number;
};

type TestResult = {
  ts: number;
  message: string;
  passed: number | null;
  failed: number | null;
  output: string | null;
};

function parseTestCounts(text: string): { passed: number | null; failed: number | null } {
  // Common patterns: "28 passed", "0 failed", "28 passed, 0 failed"
  const passedMatch = text.match(/(\d+)\s+passed/i);
  const failedMatch = text.match(/(\d+)\s+failed/i);
  return {
    passed: passedMatch ? parseInt(passedMatch[1], 10) : null,
    failed: failedMatch ? parseInt(failedMatch[1], 10) : null,
  };
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

function extractTestResult(events: Event[], artifacts: Artifact[]): TestResult | null {
  // Look for verification.check_completed events with test-related checks
  let best: TestResult | null = null;
  for (const e of events) {
    if (e.kind !== "verification.check_completed") continue;
    try {
      const p = JSON.parse(e.payload_json) as {
        check: string;
        pass: boolean;
        message?: string;
        output?: string;
      };
      if (p.check === "existing_tests" || p.check === "plan_tests_added") {
        const text = p.output ?? p.message ?? "";
        const { passed, failed } = parseTestCounts(text);
        best = {
          ts: e.ts,
          message: p.message ?? "",
          passed,
          failed,
          output: p.output ?? null,
        };
      }
    } catch {
      /* ignore */
    }
  }

  // Fall back to test_output artifact presence (we only have metadata, not content)
  if (!best && artifacts.some((a) => a.kind === "test_output")) {
    best = {
      ts: Date.now(),
      message: "Test output captured (see artifact).",
      passed: null,
      failed: null,
      output: null,
    };
  }

  return best;
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <p className="text-sm text-[var(--fg-muted)] italic">
        Test output will appear once Otis runs verification.
      </p>
    </div>
  );
}

export function TerminalTab({
  events,
  artifacts,
}: {
  events: Event[];
  artifacts: Artifact[];
}) {
  const result = useMemo(() => extractTestResult(events, artifacts), [events, artifacts]);

  if (!result) return <EmptyState />;

  const { passed, failed } = result;
  const summaryText =
    passed !== null || failed !== null
      ? [passed !== null ? `${passed} passed` : null, failed !== null ? `${failed} failed` : null]
          .filter(Boolean)
          .join(", ")
      : null;

  const displayText = result.output ?? result.message;

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-elev)] shrink-0 flex-wrap">
        <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
          Last test run
        </span>
        <span className="font-mono text-[11px] text-[var(--fg-subtle)]">
          {formatTs(result.ts)}
        </span>
        {summaryText && (
          <>
            <span className="text-[var(--border)] text-[11px]">·</span>
            <span
              className={`font-mono text-[11px] ${
                (result.failed ?? 0) > 0
                  ? "text-[var(--fail)]"
                  : "text-[var(--accent)]"
              }`}
            >
              {summaryText}
            </span>
          </>
        )}
      </div>

      {/* Output */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-[var(--bg-sunken)]">
        <pre className="font-mono text-[12px] leading-5 text-[var(--fg-muted)] whitespace-pre-wrap break-words">
          {displayText || "No output captured."}
        </pre>
      </div>
    </div>
  );
}
