import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { CheckResult } from "../types";
import type { Understanding } from "../../claude/phases/types";
import { startDevServer } from "../../orchestrator/server-lifecycle";
import { smokeTestEndpoint, type SmokeResult } from "./endpoint";
import { checkMigration, type MigrationResult } from "./migration";

type DevServerInfo = { command: string; port: number };

/** Ask the OS for a free port by binding to :0 and reading back the assigned port. */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => {
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        } else {
          reject(new Error("Could not determine free port"));
        }
      });
    });
    srv.on("error", reject);
  });
}

async function detectDevServer(cwd: string): Promise<DevServerInfo> {
  const port = await getFreePort();
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      const scripts = pkg.scripts ?? {};
      // QA5 (R5 finding 8): select by NAME with a precedence order, not by
      // command value. The previous code picked a command value then
      // reverse-looked-up its name — if two scripts shared the same command
      // (e.g. `start` and `bot:smoke` both `node server.js`), it could run
      // the wrong one. Here `bot:smoke` always wins when present.
      for (const name of ["bot:smoke", "dev", "start"]) {
        if (scripts[name]) {
          return { command: `npm run ${name}`, port };
        }
      }
    } catch {
      /* malformed package.json */
    }
  }
  return { command: "npm run dev", port };
}

type RuntimeDetail = {
  endpoints: Array<{ method: string; path: string } & SmokeResult>;
  migration: MigrationResult | null;
};

/** Path fragments that indicate server/route/endpoint files. */
const SERVER_FILE_RE =
  /(?:^|\/)(?:server|route|router|endpoint|api|handler|middleware|app)\.[^/]+$|\/api\//i;

export async function checkRuntime(args: {
  cwd: string;
  runtimeSurface: Understanding["runtime_surface"];
  diffPaths?: string[];
}): Promise<CheckResult> {
  const { cwd, runtimeSurface, diffPaths = [] } = args;

  const hasEndpoints = runtimeSurface.adds_or_modifies_endpoints.length > 0;
  const hasMigration = runtimeSurface.adds_migration;
  const needsServer = runtimeSurface.starts_dev_server || hasEndpoints;

  if (!needsServer && !hasMigration) {
    // Warn if the diff touches server/route files but runtime_surface declares nothing.
    const touchesServerFiles = diffPaths.some((p) => SERVER_FILE_RE.test(p));
    if (touchesServerFiles) {
      console.warn(
        "[runtime] diff touches server/route files but runtime_surface declares no endpoints or dev server — skipping runtime check",
      );
    }
    return {
      name: "runtime_verification",
      pass: true,
      hardGate: false,
      message: "No runtime surface declared — skipped.",
    };
  }

  const detail: RuntimeDetail = { endpoints: [], migration: null };

  // Run migration check before starting a server (migration may be independent).
  if (hasMigration) {
    // QA3 (R3 finding 5): pass expectMigrations so "declared a migration but
    // none found" hard-fails instead of silently passing.
    const migResult = await checkMigration({ cwd, expectMigrations: true });
    detail.migration = migResult;
    if (!migResult.pass && !needsServer) {
      return {
        name: "runtime_verification",
        pass: false,
        hardGate: true,
        message: migResult.message,
        detail,
      };
    }
  }

  if (!needsServer) {
    // Only migration was needed; migration result is already in detail.
    const pass = detail.migration?.pass !== false;
    return {
      name: "runtime_verification",
      pass,
      hardGate: true,
      message: pass ? "Migration passed." : detail.migration?.message ?? "Migration failed.",
      detail,
    };
  }

  const { command, port } = await detectDevServer(cwd);
  const serverResult = await startDevServer({ cwd, command, port });

  if (!serverResult.ok) {
    return {
      name: "runtime_verification",
      pass: false,
      hardGate: true,
      message: `Dev server did not become ready: ${serverResult.error}`,
      detail,
    };
  }

  const { handle } = serverResult;
  const baseUrl = `http://127.0.0.1:${handle.port}`;

  try {
    for (const ep of runtimeSurface.adds_or_modifies_endpoints) {
      const result = await smokeTestEndpoint({
        baseUrl,
        method: ep.method,
        path: ep.path,
      });
      detail.endpoints.push({ ...ep, ...result });
    }
  } finally {
    await handle.stop();
  }

  const endpointsFailed = detail.endpoints.filter((e) => !e.pass);
  const migrationFailed = detail.migration && !detail.migration.pass;
  const pass = endpointsFailed.length === 0 && !migrationFailed;

  const messages: string[] = [];
  if (endpointsFailed.length > 0) {
    messages.push(
      `${endpointsFailed.length} endpoint(s) failed: ${endpointsFailed.map((e) => `${e.method} ${e.path} → ${e.status}`).join(", ")}`,
    );
  }
  if (migrationFailed) {
    messages.push(`migration failed: ${detail.migration!.message}`);
  }

  return {
    name: "runtime_verification",
    pass,
    hardGate: true,
    message:
      messages.length > 0
        ? messages.join("; ")
        : `${detail.endpoints.length} endpoint(s) smoke-tested OK${hasMigration ? ", migration passed" : ""}.`,
    detail,
  };
}
