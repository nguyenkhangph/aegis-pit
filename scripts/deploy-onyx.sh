#!/usr/bin/env bash
# Deploy p/aegis_core, r/aegis_pit and r/sample_consumer to Gno.land Onyx (onyx-1)
# under your address namespace.  Usage: scripts/deploy-onyx.sh <gnokey-key-name>
set -euo pipefail
KEY="${1:?usage: deploy-onyx.sh <gnokey-key-name>}"
REMOTE="${GNO_RPC:-https://rpc.onyx.testnets.gno.land:443}"
CHAIN="${GNO_CHAIN_ID:-onyx-1}"
ADDR="$(gnokey list | grep -E "\. $KEY " | grep -oE 'g1[0-9a-z]{38}' | head -1)"
[ -n "$ADDR" ] || { echo "key '$KEY' not found in gnokey list"; exit 1; }
echo "Deploying as $KEY ($ADDR) to $CHAIN"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
cp -r "$ROOT/p" "$ROOT/r" "$TMP/"
# swap the local placeholder namespace for your address namespace
grep -rl 'aegispit' "$TMP" | xargs sed -i.bak "s#gno.land/p/aegispit/#gno.land/p/$ADDR/#g; s#gno.land/r/aegispit/#gno.land/r/$ADDR/#g"
find "$TMP" -name '*.bak' -delete

deploy() { # dir pkgpath
  echo "→ addpkg $2"
  gnokey maketx addpkg -pkgpath "$2" -pkgdir "$1" \
    -gas-fee 1000000ugnot -gas-wanted 60000000 -max-deposit 100000000ugnot \
    -broadcast -chainid "$CHAIN" -remote "$REMOTE" "$KEY"
}
deploy "$TMP/p/aegis_core"      "gno.land/p/$ADDR/aegis_core"
deploy "$TMP/r/aegis_pit"       "gno.land/r/$ADDR/aegis_pit"
deploy "$TMP/r/sample_consumer" "gno.land/r/$ADDR/sample_consumer"

echo
echo "✅ Live:"
echo "  https://onyx.testnets.gno.land/r/$ADDR/aegis_pit"
echo "  https://onyx.testnets.gno.land/r/$ADDR/sample_consumer"
echo "Set on Vercel:  VITE_REALM_PATH=gno.land/r/$ADDR/aegis_pit"
echo "Set in agent/.env: AEGIS_REALM=gno.land/r/$ADDR/aegis_pit"
