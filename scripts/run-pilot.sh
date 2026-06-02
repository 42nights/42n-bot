#!/usr/bin/env bash
# Run a set of SWE-bench instances through Otis in parallel waves.
# Each instance runs in its own process (own venv + PATH → no global-PATH race),
# writing its own predictions file under $OUTDIR. Merge the *.jsonl afterward.
#
# Usage:
#   BOT_DB_PATH=data/swebench/pilot.db bash scripts/run-pilot.sh <instance_id> [<instance_id> ...]
# Env:
#   PARALLEL  concurrent processes per wave (default 4)
#   OUTDIR    predictions/log dir (default data/swebench/pilot)
#   PERRUN    per-instance USD cap (default 5)
#   EXTRA     extra flags forwarded to harness.js (e.g. "--no-venv" on the VM)
set -u

PARALLEL="${PARALLEL:-4}"
OUTDIR="${OUTDIR:-data/swebench/pilot}"
PERRUN="${PERRUN:-5}"
EXTRA="${EXTRA:-}"
MAXCOST=$((PERRUN + 1))

mkdir -p "$OUTDIR"
running=0
for id in "$@"; do
  (
    echo "[start $id $(date +%H:%M:%S)]"
    node dist/src/swebench/harness.js \
      --instances "$id" \
      --out "$OUTDIR/$id.jsonl" \
      --concurrency 1 \
      --per-run-cap "$PERRUN" \
      --max-cost "$MAXCOST" \
      $EXTRA >"$OUTDIR/$id.log" 2>&1
    echo "[done $id rc=$? $(date +%H:%M:%S)]"
  ) &
  running=$((running + 1))
  if (( running % PARALLEL == 0 )); then wait; fi
done
wait
echo "==== ALL PILOT INSTANCES COMPLETE ===="
