# SWE-bench Adapter for Otis

Headless SWE-bench evaluation harness that drives Otis's UNDERSTAND → REPRODUCE | DESIGN → PLAN → IMPLEMENT↔VERIFY pipeline against the SWE-bench_Verified dataset, bypassing all GitHub side effects.

## What this is

Each SWE-bench instance becomes an `IssueForPrompt`. Otis's phase pipeline runs in a git worktree checked out at the instance's `base_commit`. After the loop, the model's source-only diff is captured and stripped of test files, then written to `predictions.jsonl` in SWE-bench wire format.

**GitHub bypassed:** no labels, no comments, no `git push`, no PRs.

## Local-runnable-now (this mac, arm64)

- Dataset load and disk cache
- `git clone` + base_commit checkout in isolated worktrees
- Full UNDERSTAND → VERIFY loop with venv-provisioned pure-Python repos (requests, pylint, pytest, sympy)
- Diff capture + test-file strip
- `predictions.jsonl` output with resume support

**Smoke test (one instance, no grading):**

```bash
cd /path/to/42n-bot
USE_ANTHROPIC_API_KEY=1 npm run swebench -- \
  --instances pydata__xarray-1234 \
  --concurrency 1 \
  --out data/swebench/smoke.jsonl
```

## VM-only

**Full 500-instance run** (inside SWE-bench Docker images with pre-built envs):

```bash
USE_ANTHROPIC_API_KEY=1 npm run swebench -- \
  --no-venv \
  --concurrency 4 \
  --max-cost 200 \
  --resume \
  --out data/swebench/predictions.jsonl
```

**Grading** — ship `predictions.jsonl` to an x86 Linux VM with Docker, then:

```bash
pip install swebench
bash src/swebench/grade.sh data/swebench/predictions.jsonl my-run-001
```

Output: `my-run-001.SWE-bench_Verified.json` with resolved/unresolved/errored counts.

**Grading does not run on arm64/local.** SWE-bench Docker images are x86-only.

## Flags

| Flag | Default | Description |
|---|---|---|
| `--dataset` | `SWE-bench/SWE-bench_Verified` | HF dataset name |
| `--split` | `test` | Dataset split |
| `--instances` | (all) | Comma-list of instance_ids |
| `--limit N` | (none) | Cap total instances run |
| `--concurrency N` | 3 | Parallel instances (each spawns claude subprocesses) |
| `--max-cost N` | (none) | Global USD ceiling |
| `--per-run-cap N` | botConfig | Per-instance USD cap |
| `--out` | `data/swebench/predictions.jsonl` | Output file |
| `--resume` | off | Skip already-attempted instances |
| `--model-name` | `otis-v2` | `model_name_or_path` field in predictions |
| `--strip` | see config.ts | Comma-list of regex sources for test-file strip |
| `--no-venv` | off | Skip Python venv provisioning (VM mode) |
| `--no-cache` | off | Re-fetch dataset even if cache exists |

## Resume / budget semantics

- A prediction row is written for **every** attempted instance (empty patch = unresolved). `--resume` skips any instance already in the output file.
- `--max-cost` is checked before launching each instance. Instances over budget get an empty-patch row so `--resume` won't retry them.
- Each instance runs independently in its own git worktree; `data/bot.db` is shared across concurrent workers (better-sqlite3 WAL handles concurrent writes safely).

## Verification caveat

Otis runs `pytest -x` across the **whole** test suite. SWE-bench grades only the specific FAIL_TO_PASS/PASS_TO_PASS test node-ids. Otis's verdict is a self-signal for guiding implementation retries — it is **not** the authoritative grade. Run `grade.sh` on the VM for the real score.

## Hard prerequisites

- Run from `42n-bot` repo root (`data/bot.db` and `schema.sql` resolve from cwd)
- `claude` CLI on PATH (or `CLAUDE_CODE_PATH` env var)
- `USE_ANTHROPIC_API_KEY=1` or valid `claude` keychain login
- **Do NOT run the Otis coordinator against the same `data/bot.db`** — its reaper will sweep active-status runs to `failed`
