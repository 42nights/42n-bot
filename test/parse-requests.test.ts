import { describe, it, expect } from "vitest";
import { parseImplementerRequests } from "../src/claude/parse-requests";

describe("parseImplementerRequests", () => {
  it("extracts start_dev_server from a fenced JSON block", () => {
    const text = `
I need to start the dev server before testing the new endpoint.

\`\`\`json
{
  "request": "start_dev_server",
  "command": "npm run dev",
  "port": 3001
}
\`\`\`

Then I will hit the endpoint.
`;
    const results = parseImplementerRequests(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      kind: "start_dev_server",
      command: "npm run dev",
      port: 3001,
    });
  });

  it("extracts plan_revision from a bare JSON object embedded in prose", () => {
    const text = `
After reading the code I realize the plan is wrong.
{"needs_plan_revision":true,"discovered":"The bug is in lib/errors.ts, not auth.ts","suggested_new_files":["lib/errors.ts"]}
Proceeding with the corrected plan.
`;
    const results = parseImplementerRequests(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      kind: "plan_revision",
      discovered: "The bug is in lib/errors.ts, not auth.ts",
      suggestedNewFiles: ["lib/errors.ts"],
    });
  });

  it("extracts multiple requests from mixed prose + fenced blocks", () => {
    const text = `
Step 1: request a plan revision.
\`\`\`json
{"needs_plan_revision":true,"discovered":"wrong file","suggested_new_files":["foo.ts","bar.ts"]}
\`\`\`

Step 2: start the server.
\`\`\`json
{"request":"start_dev_server","command":"pnpm dev","port":4000}
\`\`\`
`;
    const results = parseImplementerRequests(text);
    expect(results).toHaveLength(2);
    expect(results[0].kind).toBe("plan_revision");
    expect(results[1].kind).toBe("start_dev_server");
    if (results[1].kind === "start_dev_server") {
      expect(results[1].port).toBe(4000);
      expect(results[1].command).toBe("pnpm dev");
    }
    if (results[0].kind === "plan_revision") {
      expect(results[0].suggestedNewFiles).toEqual(["foo.ts", "bar.ts"]);
    }
  });

  it("ignores malformed JSON and unrecognized blocks", () => {
    const text = `
Here is some broken JSON: { this is not valid }
And here is valid but irrelevant JSON:
\`\`\`json
{"some_other_key": true, "value": 42}
\`\`\`
No requests here.
`;
    const results = parseImplementerRequests(text);
    expect(results).toHaveLength(0);
  });
});
