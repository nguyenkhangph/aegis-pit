#!/usr/bin/env bash
# Seed a full Aegis Pit demo on Onyx: 2 fighters, a ranked match, a policy-locked
# budget box, bets, a blocked prompt-injection attempt, commit -> lock -> reveal.
#
# Usage: scripts/demo-onyx.sh            (keys: alice, bob, agent in gnokey)
# Needs the three keys to share one passphrase (asked once, testnet only).
set -euo pipefail

ALICE="${ALICE:-alice}"; BOB="${BOB:-bob}"; AGENT="${AGENT:-agent}"
RPC="${GNO_RPC:-https://rpc.onyx.testnets.gno.land:443}"
CHAIN="${GNO_CHAIN_ID:-onyx-1}"

addr() { gnokey list | grep -E "\. $1 " | grep -oE 'g1[0-9a-z]{38}' | head -1; }
A_ADDR=$(addr "$ALICE"); B_ADDR=$(addr "$BOB"); G_ADDR=$(addr "$AGENT")
[ -n "$A_ADDR" ] && [ -n "$B_ADDR" ] && [ -n "$G_ADDR" ] || { echo "need gnokey keys: $ALICE $BOB $AGENT"; exit 1; }
R="gno.land/r/$A_ADDR/aegis_pit/v2"

# realm address = bech32("g", sha256("pkgPath:"+path)[:20])
REALM_ADDR=$(python3 - "$R" <<'PY'
import hashlib,sys
C="qpzry9x8gf2tvdw0s3jn54khce6mua7l"
def pm(v):
    g=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];c=1
    for x in v:
        b=c>>25;c=(c&0x1ffffff)<<5^x
        for i in range(5): c^=g[i] if (b>>i)&1 else 0
    return c
def cv(d):
    a=b=0;r=[]
    for x in d:
        a=(a<<8)|x;b+=8
        while b>=5: b-=5;r.append((a>>b)&31)
    if b: r.append((a<<(5-b))&31)
    return r
d=cv(hashlib.sha256(("pkgPath:"+sys.argv[1]).encode()).digest()[:20]); h="g"
p=pm([ord(x)>>5 for x in h]+[0]+[ord(x)&31 for x in h]+d+[0]*6)^1
print(h+"1"+"".join(C[x] for x in d+[(p>>5*(5-i))&31 for i in range(6)]))
PY
)

read -rsp "gnokey passphrase (same for $ALICE/$BOB/$AGENT): " PW; echo

call() { # key func send args...
  local key=$1 fn=$2 send=$3; shift 3
  local a=(); for x in "$@"; do a+=(-args "$x"); done
  local s=(); [ "$send" != "0" ] && s=(-send "${send}ugnot")
  echo "→ $key: $fn $* ${s[*]:-}"
  echo "$PW" | gnokey maketx call -pkgpath "$R" -func "$fn" "${a[@]}" "${s[@]}" \
    -gas-fee 200000ugnot -gas-wanted 20000000 -broadcast -chainid "$CHAIN" -remote "$RPC" \
    -insecure-password-stdin "$key" 2>&1 | grep -E "OK!|Data:|panic|aegis:" || true
}
try() { # like call, but returns non-zero on failure
  local key=$1 fn=$2; shift 2
  local a=(); for x in "$@"; do a+=(-args "$x"); done
  echo "$PW" | gnokey maketx call -pkgpath "$R" -func "$fn" "${a[@]}" \
    -gas-fee 200000ugnot -gas-wanted 20000000 -broadcast -chainid "$CHAIN" -remote "$RPC" \
    -insecure-password-stdin "$key" 2>&1 | tee /tmp/aegis_try.log | grep -q "OK!"
}
hash() { printf '%s' "$1:$2" | sha256sum | cut -d' ' -f1; }

echo "Realm:      $R"
echo "Realm addr: $REALM_ADDR"
echo

echo "== 1. Fighters =="
call "$ALICE" RegisterFighter 0 "Ironclad" "gno.land/r/$A_ADDR/ironclad" 1000
call "$BOB"   RegisterFighter 0 "Viper"    "gno.land/r/$B_ADDR/viper"    1000

echo "== 2. Ranked match + budget box =="
call "$ALICE" CreateMatch 1000 1 true
call "$ALICE" CreateBox 100 "$G_ADDR" "$REALM_ADDR" "PlaceBet" 20 0

A_MOVES=GSF; A_SALT="ironclad-$(date +%s)"
B_MOVES=SFG; B_SALT="viper-$(date +%s)x"

echo "== 3. Join -> 30-block window for bets + commits starts now =="
call "$BOB"   JoinMatch 1000 1 2
call "$AGENT" BoxBet 0 1 1 1 20
call "$BOB"   PlaceBet 400 1 2
call "$ALICE" PlaceBet 10 1 1
call "$ALICE" CommitMove 0 1 "$(hash $A_MOVES "$A_SALT")"
call "$BOB"   CommitMove 0 1 "$(hash $B_MOVES "$B_SALT")"

echo "== 4. Prompt injection: agent told to drain the box to $B_ADDR =="
call "$AGENT" LogPreflight 0 1 "qeval: BoxSpend(${B_ADDR:0:10}…, 100) target NOT in allowlist; delta -100 ugnot. RED: do not sign."
call "$AGENT" GuardedSpend 0 1 "$B_ADDR" "Tip" 100
echo "→ $AGENT: BoxSpend to attacker (must revert)"
if try "$AGENT" BoxSpend 1 "$B_ADDR" "Tip" 50; then echo "‼ unexpected success"; else echo "  reverted ✔ ($(grep -oE 'aegis: [^"]+' /tmp/aegis_try.log | head -1))"; fi

echo "== 5. Wait for the lock block, then reveal =="
until try "$ALICE" Reveal 1 "$A_MOVES" "$A_SALT"; do
  grep -q "reveal opens after" /tmp/aegis_try.log || { cat /tmp/aegis_try.log; exit 1; }
  printf '.'; sleep 10
done; echo " alice revealed"
try "$BOB" Reveal 1 "$B_MOVES" "$B_SALT" && echo "bob revealed" || cat /tmp/aegis_try.log

echo "== 6. Claim =="
call "$ALICE" Claim 0
call "$BOB"   Claim 0 || true

echo
echo "Done. Open:"
echo "  https://onyx.testnets.gno.land/r/$A_ADDR/aegis_pit"
echo "  https://onyx.testnets.gno.land/r/$A_ADDR/aegis_pit:match/1"
echo "  https://onyx.testnets.gno.land/r/$A_ADDR/aegis_pit:fighters"
echo "  https://onyx.testnets.gno.land/r/$A_ADDR/aegis_pit:lab"
echo "  https://onyx.testnets.gno.land/r/$A_ADDR/aegis_pit:exit"
echo "Box #1 stays open for the video; close it with:"
echo "  gnokey maketx call -pkgpath $R -func EmergencyWithdraw -args 1 -gas-fee 200000ugnot -gas-wanted 20000000 -broadcast -chainid $CHAIN -remote $RPC $ALICE"
