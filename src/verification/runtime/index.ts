import fs from "node:fs";
import path from "node:path";
import type { CheckResult } from "../types";
import type { Understanding } from "../../claude/phases/types";
import { startDevServer } from "../../orchestrator/server-lifecycle";
import { smokeTestEndpoint, type SmokeResult } from "./endpoint";
import { checkMigration, type MigrationResult } from "./migration";

type DevServerInfo = { command: string; port: number };

function detectDevServer(cwd: string): DevServerInfo {
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      const scripts = pkg.scripts ?? {};
      const command =
        scripts["bot:smoke"] ??
        scripts.dev ??
        scripts.start ??
        null;
      if (command) {
        const port = Number(process.env.PORT) || 3000;
        return { command: `npm run ${getScriptName(scripts, command)}`, port };
      }
    } catch {
      /* malformed package.json */
    }
  }
  return { command: "npm run dev", port: Number(process.env.PORT) || 3000 };
}

function getScriptName(
  scripts: Record<string, string>,
  value: string,
): string {
  const entry = Object.entries(scripts).find(([, v]) => v === value);
  return entry ? entry[0] : "dev";
}

type RuntimeDetail = {
  endpoints: Array<{ method: string; path: string } & SmokeResult>;
  migration: MigrationResult | null;
};

export async function checkRuntime(args: {
  cwd: string;
  runtimeSurface: Understanding["runtime_surface"];
}): Promise<CheckResult> {
  const { cwd, runtimeSurface } = args;

  const hasEndpoints = runtimeSurface.adds_or_modifies_endpoints.length > 0;
  const hasMigration = runtimeSurface.adds_migration;
  const needsServer = runtimeSurface.starts_dev_server || hasEndpoints;

  if (!needsServer && !hasMigration) {
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

  const { command, port } = detectDevServer(cwd);
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
      `${endpointsFailed.length} endpoint(s) 5xx: ${endpointsFailed.map((e) => `${e.method} ${e.path} → ${e.status}`).join(", ")}`,
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
