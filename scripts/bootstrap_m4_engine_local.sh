#!/usr/bin/env bash
set -euo pipefail

command -v anchor >/dev/null 2>&1 || { echo "anchor CLI is required" >&2; exit 1; }
command -v solana >/dev/null 2>&1 || { echo "solana CLI is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }

if ! command -v ephemeral-validator >/dev/null 2>&1; then
  echo "Missing ephemeral-validator." >&2
  echo "Install the