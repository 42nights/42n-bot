import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import { log } from "../shared/logger";
import { installSpawnEnv } from "../shared/spawn-env";

/**
 * Worktree dependency provisioning.
 *
 * A freshly-`git worktree add`ed checkout (and a fresh `git clone`) has NO
 * `node_modules`. Without it the implementer can't run the project's test
 * suite, the acceptance gate can't execute `acceptance_test_paths`, and the
 * runtime-verification phase can't boot the dev server — so the bot produces a
 * correct-looking diff it can never actually prove. (Observed live: the
 * implementer burned 127 tool calls thrashing against `vitest: not found`.)
 *
 * Strategy: install once in the BASE clone (idempotent, package-manager
 * aware), then symlink that `node_modules` into each worktree. Symlinking is
 * instant and avoids re-installing hundreds of MB per run. The one tradeoff:
 * a PR that ADDS a dependency won't see it until the base re-installs — fine
 * for the dominant case (bug fixes / features that don't touch package.json),
 * which is what the acceptance gate needs to run.
 *
 * Trust boundary: the cloned repo is attacker-controllable, so we install with
 * `--ignore-scripts` — a malicious `postinstall` would otherwise be arbitrary
 * RCE on the host. We also spawn with a minimal allowlisted env (see
 * installSpawnEnv) so no host secret (GITHUB_TOKEN, Convex/Anthropic keys)
 * reaches the install. Native modules that genuinely need build scripts
 * (better-sqlite3, esbuild) should be provisioned in the sandbox, not the host.
 */

type PkgManager = {
  name: string;
  install: string[];
  /** Deterministic, lockfile-pinned install. null when no usable lockfile. */
  ci: string[] | null;
};

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function detectPkgManager(repoDir: string): Promise<PkgManager | null> {
  if (!(await exists(path.join(repoDir, "package.json")))) return null;

  // Every install runs with --ignore-scripts: the clone is untrusted, so its
  // lifecycle scripts (postinstall, etc.) must never execute on the host.
  if (await exists(path.join(repoDir, "pnpm-lock.yaml"))) {
    return {
      name: "pnpm",
      install: ["pnpm", "install", "--ignore-scripts"],
      ci: ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
    };
  }
  if (await exists(path.join(repoDir, "yarn.lock"))) {
    return {
      name: "yarn",
      install: ["yarn", "install", "--ignore-scripts"],
      ci: ["yarn", "install", "--frozen-lockfile", "--ignore-scripts"],
    };
  }
  if (
    (await exists(path.join(repoDir, "bun.lockb"))) ||
    (await exists(path.join(repoDir, "bun.lock")))
  ) {
    return {
      name: "bun",
      install: ["bun", "install", "--ignore-scripts"],
      ci: ["bun", "install", "--frozen-lockfile", "--ignore-scripts"],
    };
  }
  const hasLock =
    (await exists(path.join(repoDir, "package-lock.json"))) ||
    (await exists(path.join(repoDir, "npm-shrinkwrap.json")));
  return {
    name: "npm",
    install: ["npm", "install", "--no-audit", "--no-fund", "--ignore-scripts"],
    ci: hasLock
      ? ["npm", "ci", "--no-audit", "--no-fund", "--ignore-scripts"]
      : null,
  };
}

/** Newest mtime among the lockfiles + package.json, or 0 if none readable. */
async function manifestMtime(repoDir: string): Promise<number> {
  const files = [
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "bun.lock",
  ];
  let newest = 0;
  for (const f of files) {
    try {
      const s = await fs.stat(path.join(repoDir, f));
      if (s.mtimeMs > newest) newest = s.mtimeMs;
    } catch {
      /* file absent */
    }
  }
  return newest;
}

/**
 * node_modules exists, is non-empty, and is newer than the manifest. The
 * sentinel `node_modules/.42n-deps-ok` is touched after a successful install
 * so we compare against install time, not the dir's incidental mtime.
 */
async function depsAreFresh(repoDir: string): Promise<boolean> {
  const nm = path.join(repoDir, "node_modules");
  let stat;
  try {
    stat = await fs.stat(nm);
  } catch {
    return false;
  }
  if (!stat.isDirectory()) return false;

  const sentinel = path.join(nm, ".42n-deps-ok");
  let installedAt = 0;
  try {
    installedAt = (await fs.stat(sentinel)).mtimeMs;
  } catch {
    return false; // never recorded a clean install
  }
  return installedAt >= (await manifestMtime(repoDir));
}

async function runInstall(repoDir: string, cmd: string[]): Promise<void> {
  await execa(cmd[0], cmd.slice(1), {
    cwd: repoDir,
    timeout: 300_000,
    maxBuffer: 50 * 1024 * 1024,
    // Minimal allowlisted env — never hand the host's secrets to an untrusted
    // repo's install.
    env: installSpawnEnv(),
    stdio: "ignore",
  });
}

// In-process per-repoDir mutex. Two concurrent runs on the same repo would
// otherwise both fire `npm ci` (which wipes node_modules first) and corrupt
// each other. The coordinator owns all worktree creation single-process, so an
// in-memory promise lock is sufficient.
const installLocks = new Map<string, Promise<void>>();

/**
 * Ensure the base clone has dependencies installed. Idempotent: skips when
 * node_modules is fresh, serializes concurrent callers, and is a no-op for
 * non-JS repos (pytest / go test manage their own deps).
 */
export function ensureBaseDeps(repoDir: string): Promise<void> {
  const inflight = installLocks.get(repoDir);
  if (inflight) return inflight;
  const p = ensureBaseDepsInner(repoDir).finally(() =>
    installLocks.delete(repoDir),
  );
  installLocks.set(repoDir, p);
  return p;
}

async function ensureBaseDepsInner(repoDir: string): Promise<void> {
  const pm = await detectPkgManager(repoDir);
  if (!pm) return;
  if (await depsAreFresh(repoDir)) return;

  const primary = pm.ci ?? pm.install;
  log.info("deps", `installing deps in ${repoDir} via \`${primary.join(" ")}\``);
  try {
    await runInstall(repoDir, primary);
  } catch (err) {
    if (pm.ci) {
      // ci fails when the lockfile is out of sync with package.json. Fall back
      // to a plain install so a slightly-stale lockfile doesn't brick the run.
      log.warn(
        "deps",
        `${pm.name} ci failed (${err instanceof Error ? err.message : err}); falling back to install`,
      );
      await runInstall(repoDir, pm.install);
    } else {
      throw err;
    }
  }
  await fs
    .writeFile(path.join(repoDir, "node_modules", ".42n-deps-ok"), "")
    .catch(() => {});
  log.info("deps", `deps ready in ${repoDir}`);
}

/**
 * Symlink the base clone's node_modules into a fresh worktree so its tests run
 * without a per-worktree install. No-op when the base has no node_modules
 * (install failed, or non-JS repo) or the worktree already has one.
 */
export async function linkNodeModulesIntoWorktree(
  repoDir: string,
  worktreePath: string,
): Promise<void> {
  const baseNm = path.join(repoDir, "node_modules");
  if (!(await exists(baseNm))) return;
  const wtNm = path.join(worktreePath, "node_modules");
  if (await exists(wtNm)) return;
  try {
    await fs.symlink(baseNm, wtNm, "dir");
  } catch (err) {
    log.warn("deps", `could not link node_modules into worktree: ${err}`);
  }
}
