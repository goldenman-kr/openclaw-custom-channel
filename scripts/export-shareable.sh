#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-${repo_root}/openclaw-custom-channel-shareable.tar.gz}"

cd "$repo_root"

git diff --quiet || {
  echo "Refusing to export with uncommitted changes. Commit/stash or pass through a reviewed working tree first." >&2
  exit 1
}

git diff --cached --quiet || {
  echo "Refusing to export with staged but uncommitted changes." >&2
  exit 1
}

git archive --format=tar.gz --output="$out" HEAD

echo "Wrote shareable archive: $out"
