import fs from "node:fs";
import path from "node:path";

export type ToolchainHints = {
  typecheck: string[] | null;
  test: string[] | null;
  lint: string[] | null;
  language: "ts" | "js" | "py" | "go" | "rs" | "mixed" | "unknown";
  /**
   * If the detected test runner can be told which files to run, this returns
   * the argv that does so. Null = runner doesn't support targeting (fall back
   * to the whole suite). B3 fix.
   */
  testFilesArgv: ((paths: string[]) => string[]) | null;
};

/**
 * Detect what test/lint/typecheck commands the target repo wants us to run.
 * Reads package.json scripts first, then falls back to language-specific
 * defaults. Returns command argv arrays so the caller doesn't have to
 * shell-split.
 */
export function detectToolchain(repoDir: string): ToolchainHints {
  const hints: ToolchainHints = {
    typecheck: null,
    test: null,
    lint: null,
    language: "unknown",
    testFilesArgv: null,
  };

  const pkgPath = path.join(repoDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      const scripts = pkg.scripts ?? {};
      if (scripts.typecheck) hints.typecheck = ["npm", "run", "typecheck"];
      else if (scripts["type-check"])
        hints.typecheck = ["npm", "run", "type-check"];
      else if (fs.existsSync(path.join(repoDir, "tsconfig.json"))) {
        hints.typecheck = ["npx", "tsc", "--noEmit"];
      }
      if (scripts.test) {
        hints.test = ["npm", "test", "--", "--run"];
        // Both vitest + jest accept positional file paths after `--`.
        hints.testFilesArgv = (paths) => ["npm", "test", "--", "--run", ...paths];
      }
      if (scripts.lint) hints.lint = ["npm", "run", "lint"];
      hints.language = fs.existsSync(path.join(repoDir, "tsconfig.json")) ? "ts" : "js";
    } catch {
      /* malformed package.json — fall through */
    }
  }

  if (fs.existsSync(path.join(repoDir, "Cargo.toml"))) {
    hints.typecheck = hints.typecheck ?? ["cargo", "check", "--all-targets"];
    hints.test = hints.test ?? ["cargo", "test", "--no-fail-fast"];
    // cargo test accepts a test name pattern; running specific test FILES
    // requires --test which only matches integration test names. Leave as
    // null and fall back to whole-suite.
    hints.language = "rs";
  }
  if (fs.existsSync(path.join(repoDir, "go.mod"))) {
    hints.typecheck = hints.typecheck ?? ["go", "vet", "./..."];
    hints.test = hints.test ?? ["go", "test", "./..."];
    // `go test ./pkg/...` runs all tests in a package. Map file paths to
    // their containing directory.
    hints.testFilesArgv =
      hints.testFilesArgv ??
      ((paths) => {
        const pkgs = Array.from(
          new Set(paths.map((p) => "./" + path.dirname(p))),
        );
        return ["go", "test", ...pkgs];
      });
    hints.language = "go";
  }
  if (
    fs.existsSync(path.join(repoDir, "pyproject.toml")) ||
    fs.existsSync(path.join(repoDir, "setup.py"))
  ) {
    if (!hints.typecheck) {
      const mypy = fs.existsSync(path.join(repoDir, "mypy.ini"));
      if (mypy) hints.typecheck = ["mypy", "."];
    }
    hints.test = hints.test ?? ["pytest", "-x"];
    hints.testFilesArgv =
      hints.testFilesArgv ?? ((paths) => ["pytest", "-x", ...paths]);
    hints.language = "py";
  }

  return hints;
}
