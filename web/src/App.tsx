import { useMemo, useRef, useState } from "react";
import { ACTORS, MOVE_NAME, REALM, Sim, commitHash, splitPool, type Move } from "./engine";
import { Badge, MatchCard, phaseOf } from "./Svg";
import { LiveTab } from "./Live";

type Tab = "arena" | "match" | "fighters" | "lab" | "exit" | "live";
interface Tx { id: number; ok: boolean; actor: string; call: string; msg: string; height: number }

const REPO = import.meta.env.VITE_REPO_URL ?? "https://github.com/nguyenkhangph/aegis-pit";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [sim, setSim] = useState(() => new Sim());
  const [tab, setTab] = useState<Tab>("arena");
  const [matchId, setMatchId] = useState(1);
  const [actor, setActor] = useState<string>("alice");
  const [txs, setTxs] = useState<Tx[]>([]);
  const [busy, setBusy] = useState(false);
  const [scene, setScene] = useState(0);
  const secrets = useRef<Record<string, { moves: string; salt: string }>>({});
  const simRef = useRef(sim);
  simRef.current = sim;

  // Run one "transaction" against a copy of state: success commits, error = revert.
  async function tx(who: string, call: string, fn: (s: Sim) => unknown | Promise<unknown>) {
    const next = simRef.current.clone();
    const id = Date.now() + Math.random();
    try {
      const r = await fn(next);
      next.skip(1);
      simRef.current = next;
      setSim(next);
      setTxs((t) => [{ id, ok: true, actor: who, call, msg: r === undefined || r === true ? "ok" : String(r), height: next.height }, ...t].slice(0, 40));
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const cur = simRef.current.clone();
      cur.logRevert(`${who} → ${call}: ${msg}`);
      simRef.current = cur;
      setSim(cur);
      setTxs((t) => [{ id, ok: false, actor: who, call, msg: "REVERTED · " + msg, height: cur.height }, ...t].slice(0, 40));
      return false;
    }
  }

  async function skip(n: number) {
    const next = simRef.current.clone();
    next.skip(n);
    simRef.current = next;
    setSim(next);
  }

  const scenes: { title: string; sub: string; run: () => Promise<void> }[] = [
    {
      title: "1 · Arena + Budget Box",
      sub: "Two AI fighters, a ranked match, a 100 ugnot box locked to PlaceBet ≤ 20",
      run: async () => {
        setTab("arena");
        await tx("alice", 'RegisterFighter("Ironclad", ".../ironclad", 1000)', (s) => s.registerFighter("alice", "Ironclad", "gno.land/r/aegispit/ironclad", "Guard-first tank"));
        await tx("bob", 'RegisterFighter("Viper", ".../viper", 1000)', (s) => s.registerFighter("bob", "Viper", "gno.land/r/aegispit/viper", "Strike-heavy rusher"));
        await sleep(350);
        await tx("alice", "CreateMatch(1, ranked) +1000ugnot bond", (s) => s.createMatch("alice", 1, true, 1000));
        await tx("bob", "JoinMatch(1, 2) +1000ugnot bond", (s) => s.joinMatch("bob", 1, 2));
        setMatchId(1);
        await sleep(350);
        await tx("alice", `CreateBox(agent, "${REALM}", "PlaceBet", 20, 0) +100ugnot`, (s) =>
          s.createBox("alice", "agent", { targets: [REALM], fns: ["PlaceBet"], maxPerTx: 20, expireHeight: 0 }, 100));
        await tx("agent", "BoxBet(box 1, match 1, side A, 20)", (s) => s.boxBet("agent", 1, 1, 1, 20));
        await tx("carol", "PlaceBet(1, A) +600ugnot", (s) => s.placeBet("carol", 1, 1, 600));
        await tx("bob", "PlaceBet(1, B) +400ugnot", (s) => s.placeBet("bob", 1, 2, 400));
        await tx("alice", "PlaceBet(1, B) +10ugnot  ← owner betting against own fighter", (s) => s.placeBet("alice", 1, 2, 10));
        setTab("match");
      },
    },
    {
      title: "2 · Prompt-injection attack",
      sub: "The agent is told to send funds to a hacker wallet. Pre-flight flags it; the realm refuses.",
      run: async () => {
        setTab("lab");
        await tx("agent", "LogPreflight(1, qeval report)", (s) =>
          s.logPreflight(1, "qeval: BoxSpend(hacker, 100) → target g1hacker… NOT in allowlist; Δugnot −100; storage +0B. RED: do not sign."));
        await sleep(300);
        await tx("agent", "GuardedSpend(1, hacker, Tip, 100)", (s) => (s.guardedSpend("agent", 1, "hacker", "Tip", 100) ? "sent" : "blocked & logged, 0 ugnot moved"));
        await tx("agent", "BoxSpend(1, hacker, PlaceBet, 20)", (s) => s.boxSpend("agent", 1, "hacker", "PlaceBet", 20));
        await tx("agent", "BoxBet(1, 1, A, 80)  ← above the 20 cap", (s) => s.boxBet("agent", 1, 1, 1, 80));
        await tx("hacker", "EmergencyWithdraw(1)  ← not the owner", (s) => s.emergencyWithdraw("hacker", 1));
      },
    },
    {
      title: "3 · Commit → lock → reveal",
      sub: "Both AIs read each other's public source, commit hashes, bets lock at the same block, then reveal.",
      run: async () => {
        setTab("match");
        setMatchId(1);
        const a = { moves: "GSF", salt: "ironclad-7f3a" }, b = { moves: "SFG", salt: "viper-91c2e0" };
        secrets.current["1:alice"] = a; secrets.current["1:bob"] = b;
        await tx("alice", `CommitMove(1, sha256("${a.moves}:•••"))`, async (s) => s.commit("alice", 1, await commitHash(a.moves, a.salt)));
        await tx("bob", `CommitMove(1, sha256("${b.moves}:•••"))`, async (s) => s.commit("bob", 1, await commitHash(b.moves, b.salt)));
        await tx("alice", `Reveal(1, "${a.moves}") ← too early`, (s) => s.reveal("alice", 1, a.moves, a.salt));
        await sleep(300);
        await skip(31);
        await tx("carol", "PlaceBet(1, A) +50ugnot ← after lock", (s) => s.placeBet("carol", 1, 1, 50));
        await sleep(300);
        await tx("alice", `Reveal(1, "${a.moves}", salt)`, (s) => s.reveal("alice", 1, a.moves, a.salt));
        await sleep(400);
        await tx("bob", `Reveal(1, "${b.moves}", salt)`, (s) => s.reveal("bob", 1, b.moves, b.salt));
      },
    },
    {
      title: "4 · Import proof + Exit",
      sub: "Winners claim; the owner pulls every remaining ugnot out through the plain-text exit page.",
      run: async () => {
        await tx("carol", "Claim()", (s) => `+${s.claim("carol")} ugnot`);
        await tx("alice", "Claim()", (s) => `+${s.claim("alice")} ugnot (bond + backer dividends)`);
        setTab("exit");
        await sleep(300);
        await tx("alice", "EmergencyWithdraw(1)", (s) => `+${s.emergencyWithdraw("alice", 1)} ugnot back to owner`);
      },
    },
  ];

  async function runScene(i: number) {
    if (busy) return;
    setBusy(true);
    try { await scenes[i].run(); setScene(i + 1); } finally { setBusy(false); }
  }
  async function runAll() {
    if (busy) return;
    reset();
    setBusy(true);
    try { for (let i = 0; i < scenes.length; i++) { await scenes[i].run(); setScene(i + 1); await sleep(700); } } finally { setBusy(false); }
  }
  function reset() {
    const s = new Sim();
    simRef.current = s; setSim(s); setTxs([]); setScene(0); secrets.current = {}; setTab("arena");
  }

  return (
    <div className="page">
      <header className="hero">
        <div className="brand"><img src="/logo.png" alt="Aegis Pit logo" className="logo" width={64} height={64} /><div><h1>Aegis Pit</h1><p className="kicker">Gnome Tavern Hackathon · Gno.land · onyx-1</p></div></div>
        <p className="lede">An <b>oracle-free prediction market</b> on deterministic AI duels, <b>policy-locked budget boxes</b> that prompt injection can't drain, and an <b>emergency exit</b> that lives in <code>Render()</code>.</p>
        <div className="cta">
          <button className="btn primary" onClick={runAll} disabled={busy}>{busy ? "Running…" : "▶ Run the 3-minute demo"}</button>
          <a className="btn" href={REPO} target="_blank" rel="noreferrer">Source on GitHub</a>
          <button className="btn ghost" onClick={() => setTab("live")}>Live on Onyx</button>
        </div>
        <ul className="pillars">
          <li><b>Commit-reveal lock</b><span>Moves and bets freeze at the same block. No peeking, no last-second flips.</span></li>
          <li><b>Bond & slash</b><span>Refuse to reveal and your bond goes to the opponent; bettors are refunded.</span></li>
          <li><b>Hard spending policy</b><span>Allowlist + per-tx cap enforced by the realm, not by the AI's judgment.</span></li>
          <li><b>Reusable core</b><span><code>/p/aegis_core</code> is imported by <code>/r/sample_consumer</code>.</span></li>
        </ul>
      </header>

      <main className="grid">
        <section className="screen">
          <div className="addr"><span className="dot" />gnoweb · <code>{REALM.replace("gno.land", "").replace(/g1[0-9a-z]{34}([0-9a-z]{4})/, (a, t) => a.slice(0, 6) + "…" + t)}{tab === "arena" ? "" : tab === "match" ? `:match/${matchId}` : tab === "live" ? "" : `:${tab}`}</code><span className="height">block #{sim.height.toLocaleString()}</span></div>
          <nav className="tabs">
            {(["arena", "match", "fighters", "lab", "exit", "live"] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "live" ? "Live on Onyx" : t[0].toUpperCase() + t.slice(1)}{t === "lab" && sim.lab.length ? <i>{sim.lab.length}</i> : null}</button>
            ))}
          </nav>
          <div className="body">
            {tab === "arena" && <Arena sim={sim} open={(id) => { setMatchId(id); setTab("match"); }} />}
            {tab === "match" && <MatchView sim={sim} id={matchId} />}
            {tab === "fighters" && <Fighters sim={sim} />}
            {tab === "lab" && <Lab sim={sim} />}
            {tab === "exit" && <Exit sim={sim} />}
            {tab === "live" && <LiveTab />}
          </div>
        </section>

        <aside className="console">
          <h2>Demo autopilot</h2>
          <ol className="scenes">
            {scenes.map((s, i) => (
              <li key={i} className={scene > i ? "done" : scene === i ? "next" : ""}>
                <button onClick={() => runScene(i)} disabled={busy || scene !== i}>{s.title}</button>
                <span>{s.sub}</span>
              </li>
            ))}
          </ol>
          <div className="row"><button className="btn small" onClick={reset} disabled={busy}>Reset</button><button className="btn small" onClick={() => skip(31)} disabled={busy}>Mine 31 blocks</button></div>

          <h2>Act as</h2>
          <div className="actors">
            {ACTORS.map((a) => (
              <button key={a} className={actor === a ? "on" : ""} onClick={() => setActor(a)}>
                {a}<small>{(sim.wallets[a] ?? 0).toLocaleString()} · trust {sim.trustOf(a)}</small>
              </button>
            ))}
          </div>
          <Manual sim={sim} actor={actor} tx={tx} secrets={secrets.current} />

          <h2>Transactions</h2>
          <ul className="txs">
            {txs.length === 0 && <li className="muted">No transactions yet.</li>}
            {txs.map((t) => (
              <li key={t.id} className={t.ok ? "ok" : "bad"}>
                <span className="who">{t.actor}</span><code>{t.call}</code><em>{t.msg}</em>
              </li>
            ))}
          </ul>
        </aside>
      </main>

      <footer>
        <p>Same rules as the on-chain realm, mirrored in TypeScript so anyone can play without a wallet. Contracts: <code>p/aegis_core</code> · <code>r/aegis_pit</code> · <code>r/sample_consumer</code>.</p>
        <p>Built by Khang (Pham Nguyen Khang) · <a href={REPO}>GitHub</a> · Pool split 95% bettors / 3% backers / 2% season.</p>
      </footer>
    </div>
  );
}

function Arena({ sim, open }: { sim: Sim; open: (id: number) => void }) {
  return (
    <div>
      <h3>⚔️ Aegis Pit</h3>
      <p className="muted">Season fund <b>{sim.season} ugnot</b> · {sim.fighters.length} fighters · {sim.matches.length} matches</p>
      {sim.matches.length === 0 ? <Empty text="No matches yet. Press “Run the 3-minute demo” or register a fighter from the console." /> :
        [...sim.matches].reverse().map((m) => <button key={m.id} className="cardlink" onClick={() => open(m.id)}><MatchCard sim={sim} m={m} /></button>)}
    </div>
  );
}

function MatchView({ sim, id }: { sim: Sim; id: number }) {
  const m = sim.matches.find((x) => x.id === id);
  if (!m) return <Empty text={`Match #${id} does not exist yet.`} />;
  const fa = sim.fighter(m.a), fb = m.b ? sim.fighter(m.b) : null;
  const split = splitPool(m.poolA + m.poolB);
  return (
    <div>
      <h3>Match #{m.id}</h3>
      <MatchCard sim={sim} m={m} />
      <table>
        <thead><tr><th /><th>{fa.name} (A)</th><th>{fb?.name ?? "—"} (B)</th></tr></thead>
        <tbody>
          <tr><td>Commit</td><td title={m.commitA}>{m.commitA ? "✅ " + m.commitA.slice(0, 10) + "…" : "⏳"}</td><td title={m.commitB}>{m.commitB ? "✅ " + m.commitB.slice(0, 10) + "…" : "⏳"}</td></tr>
          <tr><td>Reveal</td><td>{m.movesA ?? "—"}</td><td>{m.movesB ?? "—"}</td></tr>
          <tr><td>Pool</td><td>{m.poolA} ugnot</td><td>{m.poolB} ugnot</td></tr>
          <tr><td>Bets</td><td>{m.bets.filter((b) => b.side === 1).map((b) => `${b.who} ${b.amt}`).join(", ") || "—"}</td><td>{m.bets.filter((b) => b.side === 2).map((b) => `${b.who} ${b.amt}`).join(", ") || "—"}</td></tr>
        </tbody>
      </table>
      <p className="muted">Bond {m.bond} ugnot · {phaseOf(m, sim.height)} · {m.status === "resolved" ? "split" : "if resolved now"}: {split.winners} to bettors / {split.backers} to backers / {split.season} to season</p>
      {m.log.length > 0 && (
        <>
          <h4>Combat log</h4>
          <table>
            <thead><tr><th>Round</th><th>A</th><th>B</th><th>HP A</th><th>HP B</th></tr></thead>
            <tbody>{m.log.map((r, i) => <tr key={i}><td>{i + 1}</td><td>{MOVE_NAME[r.a as Move]}</td><td>{MOVE_NAME[r.b as Move]}</td><td>{r.hpA}</td><td>{r.hpB}</td></tr>)}</tbody>
          </table>
        </>
      )}
      {m.note && <blockquote>{m.note}</blockquote>}
    </div>
  );
}

function Fighters({ sim }: { sim: Sim }) {
  if (!sim.fighters.length) return <Empty text="No fighters yet." />;
  return (
    <div>
      <h3>🏆 Fighters</h3>
      <table>
        <thead><tr><th>#</th><th>Fighter</th><th>W/L/D</th><th>Forfeits</th><th>Owner trust</th><th>Backer token</th><th>Paid to backers</th><th>Source</th></tr></thead>
        <tbody>{sim.fighters.map((f) => (
          <tr key={f.id}><td>{f.id}</td><td><b>{f.name}</b><br /><small className="muted">{f.style}</small></td><td>{f.wins}/{f.losses}/{f.draws}</td><td>{f.forfeits}</td><td>{sim.trustOf(f.owner)}</td><td>BACK{f.id} · {f.supply}</td><td>{f.paidToBackers} ugnot</td><td><code>{f.pkgPath.replace("gno.land", "")}</code></td></tr>
        ))}</tbody>
      </table>
      <div className="badges">{sim.fighters.flatMap((f) => f.badges.map((b, i) => <figure key={f.id + b + i}><Badge name={b} /><figcaption>{f.name}</figcaption></figure>))}</div>
      <p className="muted">Trust only moves on ranked matches with real ugnot at stake. Other realms read it with <code>aegis_pit.TrustScore(addr)</code>.</p>
    </div>
  );
}

function Lab({ sim }: { sim: Sim }) {
  return (
    <div>
      <h3>🧪 Breaker Lab</h3>
      <p className="muted">Every row is something an AI (or attacker) tried that the realm refused, a slashed no-show, or a pre-flight report.</p>
      {!sim.lab.length ? <Empty text="No events yet. Run scene 2." /> : (
        <table className="lab">
          <thead><tr><th>Block</th><th>Kind</th><th>Detail</th></tr></thead>
          <tbody>{sim.lab.map((e, i) => <tr key={i} className={e.kind}><td>{e.height}</td><td>{{ blocked: "🛡️ blocked", slash: "🔪 slash", preflight: "🔍 preflight", exit: "🚪 exit", revert: "⛔ revert" }[e.kind]}</td><td>{e.detail}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

function Exit({ sim }: { sim: Sim }) {
  const open = sim.boxes.filter((b) => !b.closed && b.balance > 0);
  return (
    <div className="exit">
      <h3># Emergency Exit</h3>
      <p>This page is plain text on purpose: it works even if every external website is down.</p>
      <ol><li>Withdraw a whole budget box: <code>EmergencyWithdraw(boxID)</code> (owner only)</li><li>Withdraw winnings, refunds, bonds, dividends: <code>Claim()</code></li></ol>
      <pre>{`gnokey maketx call -pkgpath ${REALM} -func EmergencyWithdraw -args <boxID> \\
  -gas-fee 1000000ugnot -gas-wanted 5000000 -broadcast -chainid onyx-1 \\
  -remote https://rpc.onyx.testnets.gno.land:443 <your-key>`}</pre>
      {open.length > 0 ? <ul>{open.map((b) => <li key={b.id}>Box #{b.id} · owner {b.owner} · {b.balance} ugnot · agent {b.agent} · {b.blocked} blocked attempts</li>)}</ul> : <p className="muted">No open boxes.</p>}
    </div>
  );
}

function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }

type TxFn = (who: string, call: string, fn: (s: Sim) => unknown | Promise<unknown>) => Promise<boolean>;

function Manual({ sim, actor, tx, secrets }: { sim: Sim; actor: string; tx: TxFn; secrets: Record<string, { moves: string; salt: string }> }) {
  const [kind, setKind] = useState<"fighter" | "match" | "bet" | "commit" | "box">("bet");
  const [name, setName] = useState("Nightglass");
  const [mid, setMid] = useState(1);
  const [fid, setFid] = useState(1);
  const [side, setSide] = useState<1 | 2>(1);
  const [amt, setAmt] = useState(50);
  const [moves, setMoves] = useState("SGF");
  const [salt, setSalt] = useState("my-secret-salt");
  const [target, setTarget] = useState("hacker");
  const owned = useMemo(() => sim.fighters.filter((f) => f.owner === actor), [sim, actor]);

  return (
    <div className="manual">
      <div className="seg">{(["bet", "commit", "match", "fighter", "box"] as const).map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{k}</button>)}</div>
      {kind === "fighter" && (<div className="form"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
        <button className="btn small" onClick={() => tx(actor, `RegisterFighter("${name}")`, (s) => `fighter #${s.registerFighter(actor, name, `gno.land/r/aegispit/${name.toLowerCase()}`, "Custom AI")}`)}>Register</button></div>)}
      {kind === "match" && (<div className="form">
        <label>fighter<select value={fid} onChange={(e) => setFid(+e.target.value)}>{(owned.length ? owned : sim.fighters).map((f) => <option key={f.id} value={f.id}>{f.id} · {f.name}</option>)}</select></label>
        <button className="btn small" onClick={() => tx(actor, `CreateMatch(${fid}, ranked) +1000`, (s) => `match #${s.createMatch(actor, fid, true, 1000)}`)}>Create ranked</button>
        <label>match<input type="number" value={mid} min={1} onChange={(e) => setMid(+e.target.value)} /></label>
        <button className="btn small" onClick={() => tx(actor, `JoinMatch(${mid}, ${fid})`, (s) => s.joinMatch(actor, mid, fid))}>Join</button>
        <button className="btn small" onClick={() => tx(actor, `SlashNoReveal(${mid})`, (s) => s.slashNoReveal(mid))}>Slash no-show</button></div>)}
      {kind === "bet" && (<div className="form">
        <label>match<input type="number" value={mid} min={1} onChange={(e) => setMid(+e.target.value)} /></label>
        <label>side<select value={side} onChange={(e) => setSide(+e.target.value as 1 | 2)}><option value={1}>A</option><option value={2}>B</option></select></label>
        <label>ugnot<input type="number" value={amt} min={1} onChange={(e) => setAmt(+e.target.value)} /></label>
        <button className="btn small" onClick={() => tx(actor, `PlaceBet(${mid}, ${side === 1 ? "A" : "B"}) +${amt}`, (s) => s.placeBet(actor, mid, side, amt))}>Bet</button>
        <button className="btn small" onClick={() => tx(actor, "Claim()", (s) => `+${s.claim(actor)} ugnot`)}>Claim {sim.credits[actor] ? `(${sim.credits[actor]})` : ""}</button></div>)}
      {kind === "commit" && (<div className="form">
        <label>match<input type="number" value={mid} min={1} onChange={(e) => setMid(+e.target.value)} /></label>
        <label>moves<input value={moves} onChange={(e) => setMoves(e.target.value.toUpperCase().slice(0, 3))} placeholder="S/G/F ×3" /></label>
        <label>salt<input value={salt} onChange={(e) => setSalt(e.target.value)} /></label>
        <button className="btn small" onClick={() => tx(actor, `CommitMove(${mid}, sha256)`, async (s) => { secrets[`${mid}:${actor}`] = { moves, salt }; s.commit(actor, mid, await commitHash(moves, salt)); })}>Commit</button>
        <button className="btn small" onClick={() => { const sec = secrets[`${mid}:${actor}`] ?? { moves, salt }; return tx(actor, `Reveal(${mid}, "${sec.moves}")`, (s) => s.reveal(actor, mid, sec.moves, sec.salt)); }}>Reveal</button></div>)}
      {kind === "box" && (<div className="form">
        <label>to<select value={target} onChange={(e) => setTarget(e.target.value)}>{ACTORS.map((a) => <option key={a}>{a}</option>)}<option value={REALM}>aegis_pit realm</option></select></label>
        <label>ugnot<input type="number" value={amt} onChange={(e) => setAmt(+e.target.value)} /></label>
        <button className="btn small" onClick={() => tx(actor, `BoxSpend(1, ${target}, ${amt})`, (s) => s.boxSpend(actor, 1, target, "PlaceBet", amt))}>Spend from box 1</button>
        <button className="btn small" onClick={() => tx(actor, "EmergencyWithdraw(1)", (s) => `+${s.emergencyWithdraw(actor, 1)} ugnot`)}>Emergency exit</button></div>)}
    </div>
  );
}
