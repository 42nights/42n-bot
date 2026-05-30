import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// We spy on fs rather than mocking the module so real path.join still works.
// Each test controls exactly which files "exist" and which don't.

import { detectToolchain, detectPackageManager } from "../src/verification/detect";

// Helper: make existsSync return true only for the given set of absolute paths.
function mockExists(presentPaths: string[]): void {
  const set = new Set(presentPaths);
  vi.spyOn(fs, "existsSync").mockImplementation((p) => set.has(String(p)));
}

// Helper: make readFileSync return a canned string for a specific path.
function mockRead(map: Record<string, string>): void {
  vi.spyOn(fs, "readFileSync").mockImplementation((p, ...rest) => {
    const key = String(p);
    if (key in map) return map[key];
    throw new Error(`ENOENT: ${key}`);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ROOT = "/project";

describe("detectPackageManager", () => {
  it("prefers pnpm when pnpm-lock.yaml is present", () => {
    mockExists([path.join(ROOT, "pnpm-lock.yaml"), path.join(ROOT, "yarn.lock")]);
    expect(detectPackageManager(ROOT)).toBe("pnpm");
  });

  it("picks yarn when yarn.lock is present and no pnpm lock", () => {
    mockExists([path.join(ROOT, "yarn.lock")]);
    expect(detectPackageManager(ROOT)).toBe("yarn");
  });

  it("picks bun when bun.lockb is present", () => {
    mockExists([path.join(ROOT, "bun.lockb")]);
    expect(detectPackageManager(ROOT)).toBe("bun");
  });

  it("picks bun when bun.lock is present", () => {
    mockExists([path.join(ROOT, "bun.lock")]);
    expect(detectPackageManager(ROOT)).toBe("bun");
  });

  it("defaults to npm when no lock file found", () => {
    mockExists([]);
    expect(detectPackageManager(ROOT)).toBe("npm");
  });
});

describe("detectToolchain — npm with package.json scripts", () => {
  it("detects typecheck, test, lint from npm scripts", () => {
    mockExists([
      path.join(ROOT, "package.json"),
      path.join(ROOT, "tsconfig.json"),
    ]);
    mockRead({
      [path.join(ROOT, "package.json")]: JSON.stringify({
        scripts: { typecheck: "tsc --noEmit", test: "vitest", lint: "eslint ." },
      }),
    });

    const h = detectToolchain(ROOT);
    expect(h.typecheck).toEqual(["npm", "run", "typecheck"]);
    expect(h.test).toEqual(["npm", "test", "--", "--run"]);
    expect(h.lint).toEqual(["npm", "run", "lint"]);
    expect(h.language).toBe("ts");
  });

  it("testFilesArgv appends file paths", () => {
    mockExists([path.join(ROOT, "package.json")]);
    mockRead({
      [path.join(ROOT, "package.json")]: JSON.stringify({
        scripts: { test: "vitest" },
      }),
    });

    const h = detectToolchain(ROOT);
    expect(h.testFilesArgv!(["src/foo.test.ts", "src/bar.test.ts"])).toEqual([
      "npm", "test", "--", "--run", "src/foo.test.ts", "src/bar.test.ts",
    ]);
  });
});

describe("detectToolchain — npm without scripts, tsconfig fallback", () => {
  it("falls back to npx tsc --noEmit when tsconfig.json exists but no typecheck script", () => {
    mockExists([
      path.join(ROOT, "package.json"),
      path.join(ROOT, "tsconfig.json"),
    ]);
    mockRead({
      [path.join(ROOT, "package.json")]: JSON.stringify({ scripts: {} }),
    });

    const h = detectToolchain(ROOT);
    expect(h.typecheck).toEqual(["npx", "tsc", "--noEmit"]);
    expect(h.test).toBeNull();
    expect(h.language).toBe("ts");
  });
});

describe("detectToolchain — pnpm detection", () => {
  it("uses pnpm prefix when pnpm-lock.yaml is present", () => {
    mockExists([
      path.join(ROOT, "package.json"),
      path.join(ROOT, "pnpm-lock.yaml"),
      path.join(ROOT, "tsconfig.json"),
    ]);
    mockRead({
      [path.join(ROOT, "package.json")]: JSON.stringify({
        scripts: { typecheck: "tsc --noEmit", test: "vitest", lint: "eslint ." },
      }),
    });

    const h = detectToolchain(ROOT);
    expect(h.typecheck).toEqual(["pnpm", "run", "typecheck"]);
    expect(h.test).toEqual(["pnpm", "test", "--", "--run"]);
    expect(h.lint).toEqual(["pnpm", "run", "lint"]);
  });

  it("uses pnpm exec for tsc fallback", () => {
    mockExists([
      path.join(ROOT, "package.json"),
      path.join(ROOT, "pnpm-lock.yaml"),
      path.join(ROOT, "tsconfig.json"),
    ]);
    mockRead({
      [path.join(ROOT, "package.json")]: JSON.stringify({ scripts: {} }),
    });

    const h = detectToolchain(ROOT);
    expect(h.typecheck).toEqual(["pnpm exec", "tsc", "--noEmit"]);
  });
});

describe("detectToolchain — yarn detection", () => {
  it("uses yarn prefix when yarn.lock is present", () => {
    mockExists([
      path.join(ROOT, "package.json"),
      path.join(ROOT, "yarn.lock"),
    ]);
    mockRead({
      [path.join(ROOT, "package.json")]: JSON.stringify({
        scripts: { test: "jest", lint: "eslint ." },
      }),
    });

    const h = detectToolchain(ROOT);
    expect(h.test).toEqual(["yarn", "test", "--", "--run"]);
    expect(h.lint).toEqual(["yarn", "run", "lint"]);
  });
});

describe("detectToolchain — Go", () => {
  it("detects go vet and go test for go.mod repos", () => {
    mockExists([path.join(ROOT, "go.mod")]);

    const h = detectToolchain(ROOT);
    expect(h.typecheck).toEqual(["go", "vet", "./..."]);
    expect(h.test).toEqual(["go", "test", "./..."]);
    expect(h.language).toBe("go");
  });

  it("testFilesArgv maps file paths to package directories", () => {
    mockExists([path.join(ROOT, "go.mod")]);

    const h = detectToolchain(ROOT);
    const argv = h.testFilesArgv!(["pkg/foo/foo_test.go", "pkg/foo/bar_test.go", "cmd/main_test.go"]);
    expect(argv).toEqual(["go", "test", "./pkg/foo", "./cmd"]);
  });
});

describe("detectToolchain — Python", () => {
  it("detects pytest for pyproject.toml repos", () => {
    mockExists([path.join(ROOT, "pyproject.toml")]);

    const h = detectToolchain(ROOT);
    expect(h.test).toEqual(["pytest", "-x"]);
    expect(h.language).toBe("py");
    expect(h.testFilesArgv!(["tests/test_foo.py"])).toEqual(["pytest", "-x", "tests/test_foo.py"]);
  });

  it("detects pytest for setup.py repos", () => {
    mockExists([path.join(ROOT, "setup.py")]);

    const h = detectToolchain(ROOT);
    expect(h.test).toEqual(["pytest", "-x"]);
    expect(h.language).toBe("py");
  });
});

describe("detectToolchain — Rust", () => {
  it("detects cargo check and cargo test for Cargo.toml repos", () => {
    mockExists([path.join(ROOT, "Cargo.toml")]);

    const h = detectToolchain(ROOT);
    expect(h.typecheck).toEqual(["cargo", "check", "--all-targets"]);
    expect(h.test).toEqual(["cargo", "test", "--no-fail-fast"]);
    expect(h.language).toBe("rs");
    // cargo doesn't support file targeting
    expect(h.testFilesArgv).toBeNull();
  });
});

describe("detectToolchain — language detection", () => {
  it("returns ts when package.json + tsconfig.json exist", () => {
    mockExists([path.join(ROOT, "package.json"), path.join(ROOT, "tsconfig.json")]);
    mockRead({ [path.join(ROOT, "package.json")]: JSON.stringify({ scripts: {} }) });

    expect(detectToolchain(ROOT).language).toBe("ts");
  });

  it("returns js when package.json exists without tsconfig", () => {
    mockExists([path.join(ROOT, "package.json")]);
    mockRead({ [path.join(ROOT, "package.json")]: JSON.stringify({ scripts: {} }) });

    expect(detectToolchain(ROOT).language).toBe("js");
  });

  it("returns go for go.mod", () => {
    mockExists([path.join(ROOT, "go.mod")]);
    expect(detectToolchain(ROOT).language).toBe("go");
  });

  it("returns py for pyproject.toml", () => {
    mockExists([path.join(ROOT, "pyproject.toml")]);
    expect(detectToolchain(ROOT).language).toBe("py");
  });

  it("returns rs for Cargo.toml", () => {
    mockExists([path.join(ROOT, "Cargo.toml")]);
    expect(detectToolchain(ROOT).language).toBe("rs");
  });
});

describe("detectToolchain — multiple lock files", () => {
  it("prefers pnpm over yarn when both lock files exist", () => {
    mockExists([
      path.join(ROOT, "package.json"),
      path.join(ROOT, "pnpm-lock.yaml"),
      path.join(ROOT, "yarn.lock"),
    ]);
    mockRead({
      [path.join(ROOT, "package.json")]: JSON.stringify({
        scripts: { test: "vitest" },
      }),
    });

    const h = detectToolchain(ROOT);
    expect(h.test![0]).toBe("pnpm");
  });
});

describe("detectToolchain — no config files", () => {
  it("returns unknown language when no recognized config exists", () => {
    mockExists([]);

    const h = detectToolchain(ROOT);
    expect(h.language).toBe("unknown");
    expect(h.typecheck).toBeNull();
    expect(h.test).toBeNull();
    expect(h.lint).toBeNull();
    expect(h.testFilesArgv).toBeNull();
  });
});
