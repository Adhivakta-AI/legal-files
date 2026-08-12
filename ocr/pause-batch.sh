#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

image="${OCR_IMAGE:-judgment-ocr:local}"
mapfile -t containers < <(docker ps -q --filter "ancestor=$image" --filter status=running)

if [[ "${#containers[@]}" -eq 0 ]]; then
  echo "No running OCR containers found for $image"
  exit 0
fi

docker pause "${containers[@]}"
echo "Paused ${#containers[@]} OCR containers. Resume with: sudo ./resume-batch.sh"
