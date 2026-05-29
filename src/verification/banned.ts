import type { CheckResult } from "./types";
import { botConfig } from "../../bot.config";

export function checkBannedPatterns(diffText: string): CheckResult {
  const added = diffText
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"));

  const hits: { pattern: string; line: string }[] = [];
  for (const re of botConfig.verification.bannedPatterns) {
    for (const line of added) {
      if (re.test(line)) hits.push({ pattern: String(re), line: line.slice(0, 200) });
    }
  }
  return {
    name: "banned_patterns",
    pass: hits.length === 0,
    hardGate: true,
    message:
      hits.length === 0
        ? "No banned patterns introduced."
        : `${hits.length} banned-pattern hit(s) in the diff.`,
    detail: hits,
  };
}
