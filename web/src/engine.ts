// TypeScript mirror of the on-chain rules in p/aegis_core + r/aegis_pit.
// The web demo runs the exact same logic locally so judges can play
// without a wallet; the "Live on Onyx" tab reads the real realm.

export type Move = "S" | "G" | "F";
export const START_HP = 100;
export const ROUND_DMG = 34;
export const CHIP_DMG = 8;
export const COMMIT_WINDOW = 30;
export const REVEAL_WINDOW = 30;
export const MIN_BOND = 1000;

export const MOVE_NAME: Record<Move, string> = { S: "Strike", G: "Guard", F: "Feint" };

export async function commitHash(moves: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${moves}:${salt}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function validMoves(m: string): m is string {
  return /^[SGF]{3}$/.test(m);
}

export const beats = (a: Move, b: Move) =>
  (a === "S" && b === "F") || (a === "F" && b === "G") || (a === "G" && b === "S");

export interface Round { a: Move; b: Move; hpA: number; hpB: number }

export function resolveDuel(ma: string, mb: string): { winner: 0 | 1 | 2; log: Round[] } {
  let hpA = START_HP, hpB = START_HP;
  const log: Round[] = [];
  for (let i = 0; i < 3; i++) {
    const a = ma[i] as Move, b = mb[i] as Move;
    if (a === b) { hpA -= CHIP_DMG; hpB -= CHIP_DMG; }
    else if (beats(a, b)) hpB -= ROUND_DMG;
    else hpA -= ROUND_DMG;
    hpA = Math.max(0, hpA); hpB = Math.max(0, hpB);
    log.push({ a, b, hpA, hpB });
  }
  return { winner: hpA > hpB ? 1 : hpB > hpA ? 2 : 0, log };
}

export function splitPool(total: number) {
  const backers = Math.floor((total * 300) / 10000);
  const season = Math.floor((total * 200) / 10000);
  return { winners: total - backers - season, backers, season };
}

export interface TrustRecord { wins: number; losses: number; forfeits: number; volume: number }
export function trustScore(r: TrustRecord) {
  const s = 500 + 25 * r.wins - 10 * r.losses - 150 * r.forfeits + Math.min(200, Math.floor(r.volume / 1_000_000));
  return Math.max(0, Math.min(1000, s));
}

export interface Policy { targets: string[]; fns: string[]; maxPerTx: number; expireHeight: number }
export function validateSpend(p: Policy, target: string, fn: string, amt: number, height: number): string | null {
  if (amt <= 0) return "amount must be > 0";
  if (p.expireHeight > 0 && height > p.expireHeight) return "policy expired";
  if (amt > p.maxPerTx) return "amount exceeds per-tx cap";
  if (!p.targets.includes(target)) return "target not in allowlist";
  if (!p.fns.includes("*") && !p.fns.includes(fn)) return "function not in allowlist";
  return null;
}

// ---------------------------------------------------------------------------

export interface Fighter {
  id: number; name: string; owner: string; pkgPath: string; style: string;
  wins: number; losses: number; draws: number; forfeits: number; badges: string[];
  supply: number; holders: Record<string, number>; paidToBackers: number;
}
export type Status = "open" | "live" | "resolved" | "forfeit";
export interface Match {
  id: number; ranked: boolean; a: number; b: number; bond: number;
  commitDeadline: number; revealDeadline: number;
  commitA?: string; commitB?: string; movesA?: string; movesB?: string;
  status: Status; winner: 0 | 1 | 2; poolA: number; poolB: number;
  bets: { who: string; side: 1 | 2; amt: number }[]; log: Round[]; note?: string;
}
export interface Box { id: number; owner: string; agent: string; policy: Policy; balance: number; spent: number; blocked: number; closed: boolean }
export interface LabEvent { height: number; kind: "blocked" | "slash" | "preflight" | "exit" | "revert"; detail: string }

export class AegisError extends Error {}
const fail = (m: string): never => { throw new AegisError("aegis: " + m); };

export const ACTORS = ["alice", "bob", "carol", "agent", "hacker", "tavern"] as const;
export type Actor = (typeof ACTORS)[number];
export const REALM = "gno.land/r/g1tjs9agmvxqn4r245avwht57j8jgy5sapxq96ym/aegis_pit/v2";

export class Sim {
  height = 1_204_330;
  fighters: Fighter[] = [];
  matches: Match[] = [];
  boxes: Box[] = [];
  credits: Record<string, number> = {};
  wallets: Record<string, number> = { alice: 50_000, bob: 50_000, carol: 20_000, agent: 0, hacker: 0, tavern: 0 };
  trust: Record<string, TrustRecord> = {};
  season = 0;
  lab: LabEvent[] = [];

  clone(): Sim { const s = new Sim(); Object.assign(s, structuredClone({ ...this })); return s; }

  private spend(who: string, amt: number) {
    if ((this.wallets[who] ?? 0) < amt) fail(`${who} has insufficient ugnot`);
    this.wallets[who] -= amt;
  }
  private credit(who: string, amt: number) { if (amt > 0) this.credits[who] = (this.credits[who] ?? 0) + amt; }
  private tr(who: string) { return (this.trust[who] ??= { wins: 0, losses: 0, forfeits: 0, volume: 0 }); }
  private logLab(kind: LabEvent["kind"], detail: string) { this.lab.unshift({ height: this.height, kind, detail }); this.lab = this.lab.slice(0, 50); }
  trustOf(who: string) { return trustScore(this.trust[who] ?? { wins: 0, losses: 0, forfeits: 0, volume: 0 }); }
  fighter(id: number) { return this.fighters.find((f) => f.id === id) ?? fail("fighter not found"); }
  match(id: number) { return this.matches.find((m) => m.id === id) ?? fail("match not found"); }
  box(id: number) { return this.boxes.find((b) => b.id === id) ?? fail("box not found"); }
  skip(n: number) { this.height += n; }

  registerFighter(who: string, name: string, pkgPath: string, style: string, supply = 1000) {
    const id = this.fighters.length + 1;
    this.fighters.push({ id, name, owner: who, pkgPath, style, wins: 0, losses: 0, draws: 0, forfeits: 0, badges: [], supply, holders: { [who]: supply }, paidToBackers: 0 });
    return id;
  }

  createMatch(who: string, fighterId: number, ranked: boolean, bond: number) {
    if (bond < MIN_BOND) fail(`bond below minimum (${MIN_BOND} ugnot)`);
    if (this.fighter(fighterId).owner !== who) fail("you do not control this fighter");
    this.spend(who, bond);
    const id = this.matches.length + 1;
    this.matches.push({ id, ranked, a: fighterId, b: 0, bond, commitDeadline: 0, revealDeadline: 0, status: "open", winner: 0, poolA: 0, poolB: 0, bets: [], log: [] });
    return id;
  }

  joinMatch(who: string, matchId: number, fighterId: number) {
    const m = this.match(matchId);
    if (m.status !== "open") fail("match is not open");
    const fb = this.fighter(fighterId);
    if (fb.owner !== who) fail("you do not control this fighter");
    if (this.fighter(m.a).owner === who) fail("cannot fight yourself");
    this.spend(who, m.bond);
    m.b = fighterId; m.status = "live";
    m.commitDeadline = this.height + COMMIT_WINDOW;
    m.revealDeadline = m.commitDeadline + REVEAL_WINDOW;
  }

  placeBet(who: string, matchId: number, side: 1 | 2, amt: number, fromBox = false) {
    const m = this.match(matchId);
    if (!m.ranked) fail("friendly matches have no betting");
    if (m.status !== "live" || this.height > m.commitDeadline) fail("betting is locked");
    if (amt < 1) fail("bet too small");
    if ((side === 2 && this.fighter(m.a).owner === who) || (side === 1 && this.fighter(m.b).owner === who))
      fail("owners cannot bet against their own fighter");
    if (!fromBox) this.spend(who, amt);
    m.bets.push({ who, side, amt });
    if (side === 1) m.poolA += amt; else m.poolB += amt;
  }

  commit(who: string, matchId: number, hash: string) {
    const m = this.match(matchId);
    if (m.status !== "live" || this.height > m.commitDeadline) fail("commit window closed");
    if (this.fighter(m.a).owner === who) { if (m.commitA) fail("already committed"); m.commitA = hash; }
    else if (this.fighter(m.b).owner === who) { if (m.commitB) fail("already committed"); m.commitB = hash; }
    else fail("not a fighter in this match");
  }

  async reveal(who: string, matchId: number, moves: string, salt: string) {
    const m = this.match(matchId);
    if (m.status !== "live") fail("match not live");
    if (this.height <= m.commitDeadline) fail(`reveal opens after block ${m.commitDeadline}`);
    if (this.height > m.revealDeadline) fail("reveal window closed, use SlashNoReveal");
    if (!validMoves(moves)) fail("moves must be exactly 3 of S/G/F");
    if (salt.length < 8) fail("salt must be 8..64 chars");
    const h = await commitHash(moves, salt);
    if (this.fighter(m.a).owner === who && !m.movesA) { if (h !== m.commitA) fail("reveal does not match commitment"); m.movesA = moves; }
    else if (this.fighter(m.b).owner === who && !m.movesB) { if (h !== m.commitB) fail("reveal does not match commitment"); m.movesB = moves; }
    else fail("nothing to reveal for caller");
    if (m.movesA && m.movesB) this.resolve(m);
  }

  private refund(m: Match) { for (const b of m.bets) this.credit(b.who, b.amt); }

  private resolve(m: Match) {
    const fa = this.fighter(m.a), fb = this.fighter(m.b);
    const { winner, log } = resolveDuel(m.movesA!, m.movesB!);
    m.winner = winner; m.log = log; m.status = "resolved";
    this.credit(fa.owner, m.bond); this.credit(fb.owner, m.bond);
    if (winner === 0) { fa.draws++; fb.draws++; } else if (winner === 1) { fa.wins++; fb.losses++; } else { fb.wins++; fa.losses++; }
    const total = m.poolA + m.poolB;
    if (!m.ranked) { m.note = "friendly match: no pool, no trust change"; this.badges(m); return; }
    if (winner === 0) { this.refund(m); m.note = "draw: all bets refunded"; return; }
    const wf = winner === 1 ? fa : fb, lf = winner === 1 ? fb : fa;
    const winPool = winner === 1 ? m.poolA : m.poolB;
    const tw = this.tr(wf.owner), tl = this.tr(lf.owner);
    tw.wins++; tl.losses++; tw.volume += total; tl.volume += total;
    if (winPool === 0) { this.refund(m); m.note = "nobody backed the winner: all bets refunded"; this.badges(m); return; }
    const { winners, backers, season } = splitPool(total);
    let paid = 0;
    for (const b of m.bets.filter((x) => x.side === winner)) { const s = Math.floor((b.amt * winners) / winPool); this.credit(b.who, s); paid += s; }
    let bpaid = 0;
    for (const [h, bal] of Object.entries(wf.holders)) { const s = Math.floor((bal * backers) / wf.supply); this.credit(h, s); bpaid += s; }
    wf.paidToBackers += bpaid;
    this.season += season + (winners - paid) + (backers - bpaid);
    m.note = `pool ${total} ugnot: 95% bettors / 3% backers of ${wf.name} / 2% season`;
    this.badges(m);
  }

  private badges(m: Match) {
    if (!m.winner || !m.log.length) return;
    const last = m.log[m.log.length - 1];
    const w = this.fighter(m.winner === 1 ? m.a : m.b);
    const hp = m.winner === 1 ? last.hpA : last.hpB;
    const underdog = m.winner === 1 ? m.poolA < m.poolB : m.poolB < m.poolA;
    if (w.wins === 1) w.badges.push("First Blood");
    if (hp === START_HP) w.badges.push("Untouched");
    if (m.ranked && underdog) w.badges.push("Giant Slayer");
  }

  slashNoReveal(matchId: number) {
    const m = this.match(matchId);
    if (m.status !== "live" || this.height <= m.revealDeadline) fail("nothing to slash yet");
    const fa = this.fighter(m.a), fb = this.fighter(m.b);
    this.refund(m); m.status = "forfeit";
    if (m.movesA && !m.movesB) { m.winner = 1; this.credit(fa.owner, 2 * m.bond); fb.forfeits++; fa.wins++; if (m.ranked) this.tr(fb.owner).forfeits++; this.logLab("slash", `match #${m.id}: ${fb.name} never revealed, bond ${m.bond} → ${fa.name}`); }
    else if (m.movesB && !m.movesA) { m.winner = 2; this.credit(fb.owner, 2 * m.bond); fa.forfeits++; fb.wins++; if (m.ranked) this.tr(fa.owner).forfeits++; this.logLab("slash", `match #${m.id}: ${fa.name} never revealed, bond ${m.bond} → ${fb.name}`); }
    else { this.season += 2 * m.bond; fa.forfeits++; fb.forfeits++; this.logLab("slash", `match #${m.id}: neither revealed, both bonds → season fund`); }
    m.note = "forfeit: bettors refunded";
  }

  claim(who: string) {
    const amt = this.credits[who] ?? 0;
    if (amt <= 0) fail("nothing to claim");
    delete this.credits[who]; this.wallets[who] = (this.wallets[who] ?? 0) + amt;
    return amt;
  }

  createBox(who: string, agent: string, policy: Policy, deposit: number) {
    if (deposit <= 0) fail("attach ugnot to fund the box");
    if (policy.maxPerTx <= 0) fail("maxPerTx must be > 0");
    if (!policy.targets.length) fail("policy needs at least one allowed target");
    this.spend(who, deposit);
    const id = this.boxes.length + 1;
    this.boxes.push({ id, owner: who, agent, policy, balance: deposit, spent: 0, blocked: 0, closed: false });
    return id;
  }

  private checkBox(b: Box, who: string, target: string, fn: string, amt: number) {
    if (b.closed) return "box closed";
    if (who !== b.owner && who !== b.agent) return "caller is not the box owner or its agent";
    const e = validateSpend(b.policy, target, fn, amt, this.height);
    if (e) return e;
    if (amt > b.balance) return "insufficient box balance";
    return null;
  }

  /** Hard variant: violation reverts the whole tx (we log it as a revert for the demo UI). */
  boxSpend(who: string, boxId: number, target: string, fn: string, amt: number) {
    const b = this.box(boxId);
    const e = this.checkBox(b, who, target, fn, amt);
    if (e) fail(e);
    b.balance -= amt; b.spent += amt; this.wallets[target] = (this.wallets[target] ?? 0) + amt;
  }

  guardedSpend(who: string, boxId: number, target: string, fn: string, amt: number) {
    const b = this.box(boxId);
    const e = this.checkBox(b, who, target, fn, amt);
    if (e) { b.blocked++; this.logLab("blocked", `box #${boxId} → ${target} ${fn}(${amt} ugnot): aegis: ${e}`); return false; }
    b.balance -= amt; b.spent += amt; this.wallets[target] = (this.wallets[target] ?? 0) + amt;
    return true;
  }

  boxBet(who: string, boxId: number, matchId: number, side: 1 | 2, amt: number) {
    const b = this.box(boxId);
    const e = this.checkBox(b, who, REALM, "PlaceBet", amt);
    if (e) fail(e);
    this.placeBet(b.owner, matchId, side, amt, true);
    b.balance -= amt; b.spent += amt;
  }

  logPreflight(boxId: number, report: string) { this.logLab("preflight", `box #${boxId}: ${report.slice(0, 280)}`); }
  logRevert(detail: string) { this.logLab("revert", detail); }

  emergencyWithdraw(who: string, boxId: number) {
    const b = this.box(boxId);
    if (who !== b.owner) fail("only the box owner can withdraw");
    const amt = b.balance; b.balance = 0; b.closed = true;
    this.wallets[who] += amt;
    this.logLab("exit", `box #${boxId} emergency-withdrawn: ${amt} ugnot`);
    return amt;
  }
}
