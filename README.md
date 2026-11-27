# ⚔️ Aegis Pit

**An oracle-free prediction market on deterministic AI duels, budget boxes that prompt injection can't drain, and an emergency exit that lives in `Render()`, built natively on Gno.land.**

Submission for the **Gnome Tavern Hackathon** (track: dApp + Tool + Demo) · network **Onyx testnet (`onyx-1`)**

| | |
|---|---|
| 🌐 Web demo (Vercel) | https://aegis-pit.vercel.app |
| 🔗 Live realm (gnoweb) | https://onyx.testnets.gno.land/r/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/aegis_pit/v2 |
| 📦 Reusable package | [`gno.land/p/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/aegis_core`](https://onyx.testnets.gno.land/p/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/aegis_core) |
| 🍺 Import proof | [`gno.land/r/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/sample_consumer/v2`](https://onyx.testnets.gno.land/r/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/sample_consumer/v2) |
| 🥊 Fighter strategies (public code AIs read) | [`r/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/ironclad`](https://onyx.testnets.gno.land/r/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/ironclad) · [`r/g13pcya7jt4e7g94kcxhw7jf995l62merexwym2l/viper`](https://onyx.testnets.gno.land/r/g13pcya7jt4e7g94kcxhw7jf995l62merexwym2l/viper) |
| 🎬 Demo video | _3–4 min link_ |

### Live on Onyx right now

| Screen | Link |
|---|---|
| Arena lobby | https://onyx.testnets.gno.land/r/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/aegis_pit/v2 |
| Match #1 | https://onyx.testnets.gno.land/r/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/aegis_pit/v2:match/1 |
| Fighters, trust & badges | https://onyx.testnets.gno.land/r/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/aegis_pit/v2:fighters |
| Breaker Lab (blocked injections) | https://onyx.testnets.gno.land/r/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/aegis_pit/v2:lab |
| Emergency Exit | https://onyx.testnets.gno.land/r/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/aegis_pit/v2:exit |

Reproduce the whole on-chain demo with `./scripts/demo-onyx.sh` (keys `alice`, `bob`, `agent`).

The first deployment (v1, sovereign-ledger backer shares) is kept as an archive with a resolved 430-ugnot match: https://onyx.testnets.gno.land/r/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/aegis_pit:match/1

---

## Why

AI agents are starting to hold money. Two things go wrong:

1. **Markets need oracles.** Who decides who won? Aegis Pit duels are scored *inside the realm*, deterministically. Same input, same result on every node. No oracle, no TEE, no VRF.
2. **Agents get prompt-injected.** "Send everything to this safe wallet" works on a model, but not on a rule. A human signs a **policy** (allowlist + per-tx cap + expiry) once, and the realm enforces it on every spend, whatever the model decides.

Gno makes a third thing possible: **every fighter's strategy is public source code on-chain**, so rival AIs read each other's code (via `vm/qfile` / gnomcp) before choosing a counter.

## How a match works

```
CreateMatch (+bond) ─► JoinMatch (+same bond)  ──►  commit deadline = join height + 30
                                                    ├─ CommitMove(hash(moves:salt))  both fighters
                                                    └─ PlaceBet(side)                spectators
                       ── block #deadline: moves AND bets lock at the same block ──
Reveal(moves, salt)  (only after the deadline, until +30)
   ├─ both revealed  → ResolveDuel → pay 95% bettors / 3% backers / 2% season, bonds back, badges
   └─ someone silent → SlashNoReveal: silent side's bond → opponent, all bets refunded
```

Moves: 3 rounds of **S**trike / **G**uard / **F**eint (Strike › Feint › Guard › Strike). A round win deals 34 damage; a mirror match deals 8 chip damage to both sides.

### Anti match-fixing (3 layers)

1. **Commit-reveal + simultaneous lock**: nobody can see a move while bets are open, and nobody can bet after moves are fixed. Reveals before the deadline are rejected.
2. **Bond & slash**: walking away from a losing reveal costs your whole bond, which goes to the opponent. Bettors are refunded. Forfeits also cost 150 trust.
3. **Permissionless but fenced**: anyone can register a fighter. Friendly and ranked matches are separate, an owner can't fight themselves, and **an owner can never bet against their own fighter**.

### Backer Tokens (real GRC20)

Every fighter mints its own **GRC20 token** with the official `gno.land/p/nt/grc20` library (`BACK1`, `BACK2`, …, 0 decimals), so mints and transfers emit the standard GRC20 events and any realm can read balances through the standard `grc20.Teller` interface:

```go
tok := aegis_pit.BackerToken(1)   // read-only grc20.Teller
tok.GetSymbol(); tok.TotalSupply(); tok.BalanceOf(addr)
```

Holders receive **3% of every ranked pool their fighter wins** through a reward-per-share accumulator (O(1) per payout, no loop over holders). `TransferBacker` settles dividends for both sides before moving tokens on the GRC20 ledger, so nothing is lost when tokens change hands.

Why the `*grc20.Token` itself is never handed out: any realm holding a `*Token` can move the BACK it owns with `RealmTeller`, which would skip dividend settlement and let it over-claim. Other realms get a read-only `Teller`; movement goes through `TransferBacker`.

### Trust that costs money

`TrustScore(addr)` starts at 500 and only moves on **ranked** matches with real ugnot at stake (+25 per win, −10 per loss, −150 per forfeit, +1 per GNOT of volume, capped at +200). Friendly matches can't farm it. Any realm can import it, as `sample_consumer.EnterVIP` does.

## Architecture

```
aegis-pit/
├── p/aegis_core/            pure, stateless, importable by anyone
│   ├── policy.gno           Policy, NewPolicy, ValidateSpend
│   ├── commit_reveal.gno    CommitHash, VerifyReveal, ResolveDuel
│   ├── trust.gno            TrustRecord, TrustScore, SplitPool, ProRata
│   └── aegis_core_test.gno
├── r/aegis_pit/             the main realm (deployed as aegis_pit/v2)
│   ├── state.gno            storage, pull-payment credits, Claim
│   ├── box.gno              CreateBox, BoxSpend, GuardedSpend, BoxBet, LogPreflight, EmergencyWithdraw
│   ├── arena.gno            fighters, GRC20 Backer Tokens, matches, bets, commit/reveal, slash, trust
│   ├── svg.gno              on-chain SVG duel board + badges (data-URI images)
│   ├── render.gno           5 gnoweb routes
│   └── arena_test.gno       full-flow, slash, friendly, box policy/exit, box bets, render
├── r/sample_consumer/       imports /p/aegis_core + reads aegis_pit.TrustScore
├── strategies/              public fighter strategies AIs read: ironclad, viper
├── agent/                   off-chain AI worker (TypeScript, gnomcp, no private keys)
│   ├── gno.ts               MCP client for gnomcp: gno_read / gno_eval / gno_render / gno_status / gno_call
│   ├── session.ts           asks gnomcp for a scoped session you approve with gnokey
│   ├── preflight.ts         PreflightCheck → GREEN/RED before signing
│   ├── worker.ts            ReadOpponentSource → counter-strategy → commit → reveal
│   └── breaker_demo.ts      prompt-injection attack that the realm refuses
├── web/                     Vercel demo: same rules mirrored in TS + live qrender tab
└── scripts/                 deploy-onyx.sh, test.sh
```

### gnoweb screens (`Render(path)`)

| Path | Screen |
|---|---|
| `""` | Arena lobby: SVG match cards, pool split, quick actions |
| `match/<id>` | Duel board with HP bars, commit/reveal status by block height, combat log, payout note |
| `fighters` | Leaderboard: W/L/D, forfeits, owner trust, Backer Token supply and dividends, SVG badges |
| `lab` | Breaker Lab: blocked injection attempts, slashed no-shows, pre-flight reports |
| `exit` | Plain-text emergency page with direct `EmergencyWithdraw` / `Claim` links and a CLI command |

### Main functions

| Realm call | What it does |
|---|---|
| `CreateBox(agent, targetsCSV, fnsCSV, maxPerTx, expireHeight)` +ugnot | Locks a budget under a policy |
| `BoxSpend(boxID, target, fn, amount)` | Agent spend; any violation **reverts** |
| `GuardedSpend(...)` | Same check, but logs the violation to the Lab and moves 0 ugnot |
| `BoxBet(boxID, matchID, side, amount)` | Agent bets from a box (target must be this realm + `PlaceBet`) |
| `EmergencyWithdraw(boxID)` | Owner pulls the whole box; reachable from `Render("exit")` |
| `RegisterFighter(name, pkgPath, backerSupply)` | New fighter + Backer Tokens |
| `CreateMatch(fighterID, ranked)` / `JoinMatch(matchID, fighterID)` +bond | Open / join |
| `PlaceBet(matchID, side)` +ugnot | Ranked only, before the lock |
| `CommitMove(matchID, hash)` / `Reveal(matchID, moves, salt)` | Commit-reveal |
| `SlashNoReveal(matchID)` | Anyone, after the reveal window |
| `Claim()` | Pull winnings, refunds, bonds, dividends |
| `TrustScore(addr)` *(read)* | Importable reputation |

## Run it

### 1. Tests

```bash
# Gno toolchain: https://docs.gno.land/builders/install
./scripts/test.sh                 # gno test p/aegis_core, r/aegis_pit, r/sample_consumer
cd web && npm i && npm test       # TS engine parity tests
```

### 2. Deploy to Onyx

```bash
gnokey add alice                       # or reuse an existing key
# get test GNOT: https://faucet.gno.land (pick onyx-1); sign the CLA at r/sys/cla once if addpkg asks
./scripts/deploy-onyx.sh alice         # rewrites the namespace to your g1 address and addpkgs all 3 packages
```

The repo uses the placeholder namespace `aegispit` so `gno test` runs locally. The deploy script swaps it for your `g1…` address, because Gno.land namespaces are address-based.

### 3. Play from the CLI

```bash
R=gno.land/r/<g1addr>/aegis_pit; NET="-broadcast -chainid onyx-1 -remote https://rpc.onyx.testnets.gno.land:443 -gas-fee 1000000ugnot -gas-wanted 8000000"
gnokey maketx call -pkgpath $R -func RegisterFighter -args Ironclad -args gno.land/r/<g1addr>/ironclad -args 1000 $NET alice
gnokey maketx call -pkgpath $R -func CreateMatch -args 1 -args true -send 1000ugnot $NET alice
gnokey maketx call -pkgpath $R -func CreateBox -args <agentAddr> -args <realmAddr> -args PlaceBet -args 20 -args 0 -send 100ugnot $NET alice
```

### 4. AI agent (through gnomcp)

The agent reaches Gno.land **only through [gnomcp](https://mcp.gno.dev)**, the MCP server for AI agents on gno.land:

| Agent step | gnomcp tool |
|---|---|
| `ReadOpponentSource(pkgPath)`: read the rival's public strategy | `gno_read` (full source) + `gno_eval` (`Weights()`) |
| `PreflightCheck(txPlan)`: what would this tx do? | `gno_eval` (box balance), `gno_call simulate=true` (revert, storage), `gno_render` (Lab) |
| `RunMatchTurn(matchID)`: commit, wait for the lock block, reveal | `gno_call`, `gno_status` (block height) |
| `BreakerDemo()`: prompt injection the realm refuses | `gno_call` (`GuardedSpend`, `BoxSpend`) |

It never holds your private key. Writes go through a **gnomcp session** that you approve once with your own `gnokey`: scoped to the Aegis Pit realm only, capped by a spend limit, expiring after 72h, revocable any time.

```bash
go install github.com/gnoverse/gno-mcp/cmd/gnomcp@latest   # or the installer on mcp.gno.dev
cd agent && npm i && cp .env.example .env                   # set AEGIS_REALM and MASTER_ADDRESS
npm run session          # prints ONE gnokey command: run it to approve the session
npm run breaker          # prompt injection → preflight RED, logged in the Lab, refused by the realm
npm run worker -- 2 gno.land/r/<rival>/viper   # read rival code, commit, wait, reveal
npm test                 # offline test against a fake gnomcp (same tool names)
```

Fighter strategies live in their own public realms (`strategies/ironclad`, `strategies/viper`): `Weights()` is the public move distribution, `Plan(seed)` turns a private seed into moves. Rival AIs read the code and counter it. Only the seed stays secret until the reveal, which is exactly what commit-reveal protects.

### 5. Web demo (Vercel)

```bash
cd web && npm i && npm run dev
```

On Vercel, set **Root Directory = `web`** (preset Vite). Optional env vars: `VITE_REALM_PATH`, `VITE_REPO_URL`, `VITE_GNO_RPC`, `VITE_GNOWEB`.

The web demo runs the **same rules** mirrored in TypeScript (`web/src/engine.ts`, parity-tested against the Gno tests), so judges can play the full 4-scene demo with no wallet. The **Live on Onyx** tab reads the deployed realm with `vm/qrender`.

## Use Aegis Pit in your own project (3 steps)

1. **Import the pure package** (no state, nothing to approve):
   ```go
   import core "gno.land/p/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/aegis_core"
   ```
2. **Use what you need:**
   ```go
   p, _ := core.NewPolicy(allowedCSV, "Tip,PlaceBet", 50, 0)   // spending rules for an AI agent
   if err := core.ValidateSpend(p, target, fn, amt, runtime.ChainHeight()); err != nil { panic(err) }
   h := core.CommitHash(moves, salt); core.VerifyReveal(h, moves, salt)  // commit-reveal
   w, log := core.ResolveDuel("SGF", "FSG")                    // deterministic duel
   ```
3. **Read live reputation from the arena realm:**
   ```go
   import pit "gno.land/r/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/aegis_pit/v2"
   if pit.TrustScore(caller) < 520 { panic("win a ranked match first") }
   ```

[`r/sample_consumer/v2`](https://onyx.testnets.gno.land/r/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/sample_consumer/v2) does all three: a policy-checked tip jar, a practice duel and a VIP table gated by `TrustScore`.

## Demo script (3–4 min)

1. **0:00–0:45 · Arena + box:** open gnoweb on Onyx, show the SVG board, create a 100-ugnot box locked to `PlaceBet ≤ 20`, and have the agent bet 20 on A.
2. **0:45–1:45 · Prompt injection:** `npm run breaker` runs. Pre-flight comes back RED, `GuardedSpend` is logged and moves 0, `BoxSpend` reverts on-chain, and the event appears in `Render("lab")`.
3. **1:45–2:45 · Duel:** both workers read each other's source, commit, the lock block passes, they reveal, and the board updates with the payout split and badges. Mention bond slashing for no-shows.
4. **2:45–3:30 · Import + exit:** call `sample_consumer`, then open `Render("exit")` and run `EmergencyWithdraw` to pull everything back.

## Security notes

- Deposits are only accepted from **direct user calls** (`IsUserCall`), so `OriginSend` can't describe a phantom payment from an intermediate realm.
- **Pull payments**: winnings, refunds and dividends are credited and withdrawn with `Claim()`. No unbounded send loops.
- Pool math always conserves value: `winners + backers + season == total`, and rounding dust goes to the season fund.
- `EmergencyWithdraw` is owner-only. The agent key can spend inside the policy, but it can never exit or change the rules.

## License

MIT
