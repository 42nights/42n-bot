import { Badge } from "./ui/badge";
import { Check, X, AlertTriangle } from "lucide-react";

type CheckResult = {
  name: string;
  pass: boolean;
  hardGate: boolean;
  message: string;
  detail?: unknown;
};

type Verdict = {
  pass: boolean;
  failureSummary: string;
  attempt: number;
  checks: Record<string, CheckResult>;
};

const LABELS: Record<string, string> = {
  typecheck: "Typecheck",
  existing_tests: "Test suite",
  plan_tests_added: "Plan tests added",
  mutation_light: "Mutation-light",
  lint: "Lint",
  diff_size: "Diff size",
  banned_patterns: "Banned patterns",
  critic: "Critic",
};

export function VerdictReport({
  verdict,
}: {
  verdict: Verdict;
}) {
  const checks = Object.entries(verdict.checks);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Badge variant={verdict.pass ? "success" : "error"}>
          {verdict.pass ? "Pass" : "Fail"}
        </Badge>
        <span className="text-xs text-muted-foreground">attempt {verdict.attempt}</span>
      </div>
      <div className="rounded-lg border border-border bg-background overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {checks.map(([name, c]) => (
              <tr key={name} className="border-t border-border first:border-0">
                <td className="px-3 py-2 w-1 whitespace-nowrap">
                  {c.pass ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : c.hardGate ? (
                    <X className="h-4 w-4 text-red-600" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                  )}
                </td>
                <td className="px-3 py-2 w-40 font-medium">{LABELS[name] ?? name}</td>
                <td className="px-3 py-2 text-muted-foreground">{c.message}</td>
                <td className="px-3 py-2 w-1 whitespace-nowrap text-[11px] text-muted-foreground">
                  {c.hardGate ? "hard" : "soft"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!verdict.pass && (
        <pre className="text-[11px] whitespace-pre-wrap text-muted-foreground bg-muted/40 rounded-md p-3 border border-border">
          {verdict.failureSummary}
        </pre>
      )}
    </div>
  );
}
