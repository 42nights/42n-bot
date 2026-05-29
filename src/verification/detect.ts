import fs from "node:fs";
import path from "node:path";

export type ToolchainHints = {
  typecheck: string[] | null;     // command to run; null if not detected
  test: string[] | null;
  lint: string[] | null;
  language: "ts" | "js" | "py" | "go" | "rs" | "mixed" | "unknown";
};

/**
 * Detect what test/lint/typecheck commands the target repo wants us to run.
 * Reads package.json scripts first, then falls back to language-specific
 * defaults. Returns command argv arrays so the caller doesn't have to shell-split.
 */
export function detectToolchain(repoDir: string): ToolchainHints {
  const hints: ToolchainHints = {
    typecheck: null,
    test: null,
    lint: null,
    language: "unknown",
  };

  const pkgPath = path.join(repoDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      const scripts = pkg.scripts ?? {};
      if (scripts.typecheck) hints.typecheck = ["npm", "run", "typecheck"];
      else if (scripts["type-check"]) hints.typecheck = ["npm", "run", "type-check"];
      else if (fs.existsSync(path.join(repoDir, "tsconfig.json"))) {
        hints.typecheck = ["npx", "tsc", "--noEmit"];
      }
      if (scripts.test) hints.test = ["npm", "test", "--", "--run"];
      if (scripts.lint) hints.lint = ["npm", "run", "lint"];
      hints.language = fs.existsSync(path.join(repoDir, "tsconfig.json")) ? "ts" : "js";
    } catch {
      /* malformed package.json — fall through */
    }
  }

  if (fs.existsSync(path.join(repoDir, "Cargo.toml"))) {
    hints.typecheck = hints.typecheck ?? ["cargo", "check", "--all-targets"];
    hints.test = hints.test ?? ["cargo", "test", "--no-fail-fast"];
    hints.language = "rs";
  }
  if (fs.existsSync(path.join(repoDir, "go.mod"))) {
    hints.typecheck = hints.typecheck ?? ["go", "vet", "./..."];
    hints.test = hints.test ?? ["go", "test", "./..."];
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
    hints.language = "py";
  }

  return hints;
}
