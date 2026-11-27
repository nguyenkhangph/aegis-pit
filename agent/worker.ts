// AI fighter worker, all chain access through gnomcp.
//  1. ReadOpponentSource(pkgPath): gno_read the rival's PUBLIC strategy realm
//     (everything on Gno.land is open source) and gno_eval its Weights().
//  2. Pick a counter: beat the rival's most likely move.
//  3. RunMatchTurn(matchID): commit hash(moves:salt) before the lock block,
//     wait for the lock (gno_status), reveal. Signed through the approved
//     gnomcp session — the worker never sees a private key.
import { call, close, commitHash, env, evalExpr, height, newSalt, readSource, reason, render, sleep } from "./gno.ts";

type Move = "S" | "G" | "F";
const BEATS: Record<Move, Move> = { S: "G", G: "F", F: "S" }; // BEATS[x] = move that beats x

export interface Read { pkgPath: string; source: string; weights: [number, number, number] }

export async function readOpponentSource(pkgPath: string): Promise<Read> {
  const source = await readSource(pkgPath);
  let weights: [number, number, number] | null = null;
  const ev = await evalExpr("Weights()", pkgPath).catch(() => "");
  const nums = ev.match(/-?\d+/g)?.map(Number);
  if (nums && nums.length >= 3) weights = [nums[0], nums[1], nums[2]];
  if (!weights) {
    const m = source.match(/func Weights\(\)[^{]*\{\s*return\s+(\d+),\s*(\d+),\s*(\d+)/);
    weights = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [1, 1, 1];
  }
  return { pkgPath, source, weights };
}

/** Counter the rival's favourite move twice, its second favourite once. */
export function chooseCounter([s, g, f]: [number, number, number]): string {
  const ranked = (["S", "G", "F"] as Move[]).map((m, i) => ({ m, w: [s, g, f][i] })).sort((a, b) => b.w - a.w);
  return BEATS[ranked[0].m] + BEATS[ranked[1].m] + BEATS[ranked[0].m];
}

export async function runMatchTurn(matchId: number, opponentPkg: string, log = console.log) {
  const opp = await readOpponentSource(opponentPkg);
  log(`📖 gno_read ${opponentPkg}: ${opp.source.length} bytes · Weights(S,G,F) = ${opp.weights.join(",")}`);
  const moves = chooseCounter(opp.weights);
  const salt = newSalt();
  log(`🧠 counter-strategy ${moves} (salt stays local until reveal)`);

  const c = await call({ func: "CommitMove", args: [matchId, commitHash(moves, salt)] });
  log(c.ok ? "🔒 committed" : `❌ commit failed: ${reason(c)}`);
  if (!c.ok) return;

  const page = await render(`match/${matchId}`);
  const deadline = Number(page.match(/COMMIT \+ BETS until #(\d+)/)?.[1] ?? 0);
  while (deadline && (await height()) <= deadline) {
    process.stdout.write(".");
    await sleep(5000);
  }
  for (let i = 0; i < 12; i++) {
    const r = await call({ func: "Reveal", args: [matchId, moves, salt] });
    if (r.ok) { log("\n🔓 revealed"); break; }
    if (!/reveal opens after/.test(r.text)) { log(`\n❌ reveal failed: ${reason(r)}`); break; }
    await sleep(5000);
  }
  log(`status: ${await evalExpr(`MatchStatus(${matchId})`)} · ${env.gnoweb}${env.realm.replace("gno.land", "")}:match/${matchId}`);
}

// CLI: npm run worker -- <matchId> <opponentPkgPath>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, opp] = process.argv.slice(2);
  if (!id || !opp) {
    console.error("usage: npm run worker -- <matchId> <opponentPkgPath>");
    process.exit(1);
  }
  await runMatchTurn(Number(id), opp);
  await close();
}
