#!/usr/bin/env bash
# Run all Gno unit tests (needs the `gno` CLI built from gnolang/gno chain/mainnet).
set -euo pipefail
cd "$(dirname "$0")/.."
gno test ./p/aegis_core/... ./r/aegis_pit/... ./r/sample_consumer/... ./strategies/... -v
