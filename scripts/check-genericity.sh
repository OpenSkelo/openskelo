#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PATTERN='NORA_PLAN|REI_BUILD|MARI_REVIEW|\bnora\b|\brei\b|\bmari\b|\basuka\b'
TARGETS=(src tests docs README.md)
EXCLUDES='docs/reports|tests/__snapshots__|lcov-report|vitest-results.json|coverage-summary.json'

HITS=$(grep -RInE "$PATTERN" "${TARGETS[@]}" | grep -Ev "$EXCLUDES" || true)
if [[ -n "$HITS" ]]; then
  echo "❌ Genericity check failed. Found team-specific identifiers:"
  echo "$HITS"
  exit 1
fi

echo "✅ Genericity check passed."
