export type ImplementerRequest =
  | { kind: "start_dev_server"; command: string; port: number }
  | { kind: "plan_revision"; discovered: string; suggestedNewFiles: string[] };

/**
 * Scan implementer stream text for embedded JSON request blocks.
 * Handles both fenced (```json ... ```) and bare JSON objects mixed in prose.
 */
export function parseImplementerRequests(streamText: string): ImplementerRequest[] {
  const results: ImplementerRequest[] = [];

  // Collect candidate JSON strings: fenced blocks first, then bare { ... } spans.
  const candidates: string[] = [];

  // 1. Fenced JSON blocks: ```json ... ``` (non-greedy, possibly multiline).
  const fenceRe = /```json\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(streamText)) !== null) {
    candidates.push(m[1].trim());
  }

  // 2. Bare top-level JSON objects not already captured by fence regex.
  //    Simple brace-matching scan so we don't need a full parser.
  const fenceRanges: Array<[number, number]> = [];
  const fenceRe2 = /```json\s*[\s\S]*?```/g;
  while ((m = fenceRe2.exec(streamText)) !== null) {
    fenceRanges.push([m.index, m.index + m[0].length]);
  }

  for (let i = 0; i < streamText.length; i++) {
    if (streamText[i] !== "{") continue;
    // Skip if inside a fenced block.
    if (fenceRanges.some(([s, e]) => i >= s && i < e)) continue;

    let depth = 0;
    let end = -1;
    for (let j = i; j < streamText.length; j++) {
      if (streamText[j] === "{") depth++;
      else if (streamText[j] === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end !== -1) {
      candidates.push(streamText.slice(i, end + 1));
      i = end; // skip past this object
    }
  }

  for (const raw of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    if (typeof parsed !== "object" || parsed === null) continue;
    const obj = parsed as Record<string, unknown>;

    if (obj.request === "start_dev_server") {
      const command = typeof obj.command === "string" ? obj.command : null;
      const port = typeof obj.port === "number" ? obj.port : null;
      if (command && port) {
        results.push({ kind: "start_dev_server", command, port });
      }
      continue;
    }

    if (obj.needs_plan_revision === true) {
      const discovered =
        typeof obj.discovered === "string" ? obj.discovered : "";
      const suggestedNewFiles = Array.isArray(obj.suggested_new_files)
        ? (obj.suggested_new_files as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [];
      results.push({ kind: "plan_revision", discovered, suggestedNewFiles });
    }
  }

  return results;
}
