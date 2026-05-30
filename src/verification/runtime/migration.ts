import fs from "node:fs";
import path from "node:path";
import { runCmd } from "../run";

export type MigrationResult = {
  pass: boolean;
  message: string;
  detail?: unknown;
};

/** Best-effort heuristic migration runner — target repos vary. */
export async function checkMigration(args: {
  cwd: string;
}): Promise<MigrationResult> {
  const { cwd } = args;

  // 1. package.json `scripts.migrate`
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      if (pkg.scripts?.migrate) {
        const r = await runCmd(["npm", "run", "migrate"], cwd, 120_000);
        return {
          pass: r.exitCode === 0,
          message:
            r.exitCode === 0
              ? "npm run migrate succeeded"
              : `npm run migrate failed (exit ${r.exitCode})`,
          detail: { stdout: r.stdout.slice(0, 2000), stderr: r.stderr.slice(0, 2000) },
        };
      }
    } catch {
      /* malformed package.json — fall through */
    }
  }

  // 2. Prisma migrations directory → `npx prisma migrate deploy`
  const prismaMigrationsDir = path.join(cwd, "prisma", "migrations");
  if (fs.existsSync(prismaMigrationsDir)) {
    const r = await runCmd(
      ["npx", "prisma", "migrate", "deploy"],
      cwd,
      120_000,
    );
    return {
      pass: r.exitCode === 0,
      message:
        r.exitCode === 0
          ? "prisma migrate deploy succeeded"
          : `prisma migrate deploy failed (exit ${r.exitCode})`,
      detail: { stdout: r.stdout.slice(0, 2000), stderr: r.stderr.slice(0, 2000) },
    };
  }

  // 3. Generic `migrations/` directory → `npx prisma migrate deploy` as default
  const genericMigrationsDir = path.join(cwd, "migrations");
  if (fs.existsSync(genericMigrationsDir)) {
    const r = await runCmd(
      ["npx", "prisma", "migrate", "deploy"],
      cwd,
      120_000,
    );
    return {
      pass: r.exitCode === 0,
      message:
        r.exitCode === 0
          ? "prisma migrate deploy succeeded"
          : `prisma migrate deploy failed (exit ${r.exitCode})`,
      detail: { stdout: r.stdout.slice(0, 2000), stderr: r.stderr.slice(0, 2000) },
    };
  }

  return { pass: true, message: "No migration runner detected — skipping." };
}
