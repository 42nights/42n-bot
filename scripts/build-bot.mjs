import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const entries = [
  "src/coordinator/index.ts",
  "scripts/smoke-test.ts",
];

const watch = process.argv.includes("--watch");

const opts = {
  entryPoints: entries.map((e) => path.join(root, e)),
  outdir: path.join(root, "dist"),
  outbase: root,
  platform: "node",
  target: "node22",
  format: "cjs",
  bundle: true,
  sourcemap: "inline",
  packages: "external",
  logLevel: "info",
  // Resolve `@/foo` → `./foo` from the project root, matching tsconfig.json.
  alias: { "@": root },
};

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log("[build-bot] watching…");
} else {
  await esbuild.build(opts);
  console.log("[build-bot] built once");
}
