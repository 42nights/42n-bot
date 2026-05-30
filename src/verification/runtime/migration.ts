import fs from "node:fs";
import path from "node:path";
import { runCmd } from "../run";

export type MigrationResult = {
  pass: boolean;
  message: string;
  detail?: unknown;
};

/**
 * Best-effort heuristic migration runner — target repos vary.
 *
 * QA3 (R3 finding 5): `expectMigrations` distinguishes "the understanding
 * said this change adds a migration" from "we just opportunistically check
 * for one." When a migration was EXPECTED but no runner/dir is found, that's
 * a real failure — the PR claims to add a migration but didn't — so we
 * return pass=false instead of silently passing.
 */
export async function checkMigration(args: {
  cwd: string;
  expectMigrations?: boolean;
}): Promise<MigrationResult> {
  const { cwd, expectMigrations = false } = args;

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

  // No migration runner / directory found.
  if (expectMigrations) {
    return {
      pass: false,
      message:
        "The change declared it adds a migration, but no migration runner " +
        "(scripts.migrate / prisma/migrations / migrations/) was found in the diff.",
      detail: { expectMigrations: true, found: false },
    };
  }
  return { pass: true, message: "No migration runner detected — skipping." };
}
