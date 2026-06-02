#!/usr/bin/env bash
# Grade predictions.jsonl using the official SWE-bench Docker harness.
#
# IMPORTANT: Run this on an x86 Linux VM with Docker installed.
# This script does NOT work on arm64/macOS — SWE-bench Docker images are
# x86-only (amd64). Build the VM image first:
#   pip install swebench
# Then invoke:
#   bash src/swebench/grade.sh data/swebench/predictions.jsonl otis-run-1
#
# Output: <RUN_ID>.SWE-bench_Verified.json in the current directory,
# containing resolved / unresolved / errored counts and per-instance results.
set -euo pipefail

PRED="${1:-data/swebench/predictions.jsonl}"
RUN_ID="${2:-otis-$(date +%s)}"
DATASET="${3:-SWE-bench/SWE-bench_Verified}"
MAX_WORKERS="${4:-8}"

if [ ! -f "$PRED" ]; then
  echo "Error: predictions file not found: $PRED" >&2
  exit 1
fi

echo "Grading ${PRED} with run_id=${RUN_ID} on dataset=${DATASET}"

python -m swebench.harness.run_evaluation \
  --dataset_name "${DATASET}" \
  --predictions_path "${PRED}" \
  --max_workers "${MAX_WORKERS}" \
  --run_id "${RUN_ID}"

echo "Results written to ${RUN_ID}.${DATASET//\//.}.json"
