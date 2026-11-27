#!/usr/bin/env bash
# Deploy Aegis Pit to Gno.land Onyx (onyx-1) under your address namespace.
#   scripts/deploy-onyx.sh <owner-key> [<rival-key>]
# owner-key deploys p/aegis_core, r/aegis_pit/v2, r/sample_consumer/v2, r/ironclad
# rival-key (default: bob) deploys r/viper, the second fighter's public strategy.
# Packages already on chain (live or awaiting approval) are skipped.
set -euo pipefail
KEY="${1:?usage: deploy-onyx.sh <owner-key> [<rival-key>]}"; RIVAL="${2:-bob}"
REMOTE="${GNO_RPC:-https://rpc.onyx.testnets.gno.land:443}"
CHAIN="${GNO_CHAIN_ID:-onyx-1}"
addr() { gnokey list | grep -E "\. $1 " | grep -oE 'g1[0-9a-z]{38}' | head -1; }
ADDR="$(addr "$KEY")"; RADDR="$(addr "$RIVAL" || true)"
[ -n "$ADDR" ] || { echo "key '$KEY' not found in gnokey list"; exit 1; }
echo "Owner $KEY ($ADDR) · rival $RIVAL (${RADDR:-missing}) · $CHAIN"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; cp -r "$ROOT/p" "$ROOT/r" "$ROOT/strategies" "$TMP/"
grep -rl 'aegispit' "$TMP" | xargs sed -i "s#gno.land/p/aegispit/#gno.land/p/$ADDR/#g; s#gno.land/r/aegispit/#gno.land/r/$ADDR/#g"
[ -n "$RADDR" ] && sed -i "s#gno.land/r/$ADDR/viper#gno.land/r/$RADDR/viper#" "$TMP/strategies/viper/gnomod.toml"

exists() { gnokey query vm/qpkgmeta_json -data "$1" -remote "$REMOTE" 2>/dev/null | grep -q '"status"'; }
deploy() { # dir pkgpath key
  if exists "$2"; then echo "✓ $2 already on chain, skipping"; return; fi
  echo "→ addpkg $2 (as $3)"
  gnokey maketx addpkg -pkgpath "$2" -pkgdir "$1" \
    -gas-fee 1000000ugnot -gas-wanted 80000000 -max-deposit 100000000ugnot \
    -broadcast -chainid "$CHAIN" -remote "$REMOTE" "$3"
}
deploy "$TMP/p/aegis_core"         "gno.land/p/$ADDR/aegis_core"         "$KEY"
deploy "$TMP/r/aegis_pit"          "gno.land/r/$ADDR/aegis_pit/v2"       "$KEY"
deploy "$TMP/r/sample_consumer"    "gno.land/r/$ADDR/sample_consumer/v2" "$KEY"
deploy "$TMP/strategies/ironclad"  "gno.land/r/$ADDR/ironclad"           "$KEY"
[ -n "$RADDR" ] && deploy "$TMP/strategies/viper" "gno.land/r/$RADDR/viper" "$RIVAL"

cat <<MSG

Submitted. Onyx parks new packages until its approver bot (gpao) enables them,
usually minutes, sometimes hours. Check with:
  gnokey query vm/qpkgmeta_json -data gno.land/r/$ADDR/aegis_pit/v2 -remote $REMOTE
Then:
  https://onyx.testnets.gno.land/r/$ADDR/aegis_pit/v2
  https://onyx.testnets.gno.land/r/$ADDR/ironclad   https://onyx.testnets.gno.land/r/${RADDR:-<rival>}/viper
Vercel:  VITE_REALM_PATH=gno.land/r/$ADDR/aegis_pit/v2
agent/.env: AEGIS_REALM=gno.land/r/$ADDR/aegis_pit/v2
MSG
