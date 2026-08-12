#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

if [[ ! -f .env ]]; then
  echo "Missing $script_dir/.env. Copy .env.example to .env and set BATCH_DIR." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${BATCH_DIR:?Set BATCH_DIR in .env}"
log_file="${BATCH_LOG:-$BATCH_DIR/run-current.log}"
pid_file="$BATCH_DIR/run-batch.pid"

mkdir -p "$BATCH_DIR"

if [[ -f "$pid_file" ]]; then
  existing_pid="$(cat "$pid_file")"
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "Batch is already running as PID $existing_pid"
    echo "Log: $log_file"
    exit 0
  fi
fi

nohup setsid "$script_dir/run-batch.sh" >>"$log_file" 2>&1 </dev/null &
pid="$!"
printf '%s\n' "$pid" >"$pid_file"

echo "Started OCR batch as PID $pid"
echo "Log: $log_file"
echo "Monitor with: tail -f '$log_file'"
