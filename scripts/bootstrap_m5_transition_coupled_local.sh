#!/usr/bin/env bash
set -euo pipefail

# The deployed/local Reactor identity is defined by target/deploy/reactor-keypair.json.
# Keep declare_id! and the generated IDL synchronized with that keypair BEFORE the
# hardened bootstrap runs anchor build; otherwise a stale source ID can generate a
# mismatched IDL and correctly trip the deploy guard.
echo "Preflighting Reactor program identity..."
npm install >/dev/null
if [[ !