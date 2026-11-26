// AI fighter worker.
//  1. ReadOpponentSource: pull the rival fighter's public Gno source from chain.
//  2. Pick a counter-strategy (deterministic heuristic; swap in an LLM call if you like —
//     the realm doesn't care how the moves were chosen, only that they were committed).
//  3. RunMatchTurn: commit before the deadline, wait, reveal after it.
// Signing goes through the local gnokey key `FIGHTER_KEY` (or a gnomcp session key).
import { call, commitHash, env, newSalt, qeval, qrender, readSource } from "./gno.ts";

type Move = "S" | "G" | "F";
const COUNTER: Record<Move, Move> = { S: "G", G: "F", F: "S" }; // what beats X

export async function readOpponentSource(pkgPath: string) {
  try {
    return await readSource(pkgPath);
  } catch {
    return {} as Record<string, string>;
  }
}

/** Count which moves the opponent's code favours and counter the most likely one per round. */
export function chooseCounter(source: Record<string, string>): string {
  const code = Object.values(source).join("\n");
  const plan = code.match(/["'`]([SGF]{3})["'`]/)?.[1];
  if (plan) return [...plan].map((m) => COUNTER[m as Move]).join(""); // they hard-coded a plan
  const count = (re: RegExp) => (code.match(re) ?? []).length;
  const fav: Move = [["S", count(/strike|"S"/gi)], ["G", count(/guard|"G"/gi)], ["F", count(/feint|"F"/gi)]]
    .sort((a, b) => (b[1] as number) - (a[1] as number))[0][0] as Move;
  // Counter their favourite twice, then hedge.
  return COUNTER[fav] + COUNTER[fav] + COUNTER[COUNTER[fav]];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chainHeight(): Promise<number> {
  const res = await fetch(`${env.rpc.replace(/:443$/, "")}/status`);
  const j = (await res.json()) as any;
  return Number(j.result.sync_info.latest_block_height);
}

export async function runMatchTurn(matchId: number, opponentPkg: string) {
  const src = await readOpponentSource(opponentPkg);
  console.log(`📖 read ${Object.keys(src).length} file(s) of ${opponentPkg}`);
  const moves = chooseCounter(src);
  const salt = newSalt();
  console.log(`🧠 strategy ${moves} (salt kept locally)`);

  console.log(await call({ key: env.fighterKey, func: "CommitMove", args: [matchId, commitHash(moves, salt)] }));

  // Wait for the commit deadline shown on the match page.
  const page = await qrender(env.realm, `match/${matchId}`);
  const deadline = Number(page.match(/COMMIT \+ BETS until #(\d+)/)?.[1] ?? 0);
  while (deadline && (await chainHeight()) <= deadline) {
    process.stdout.write(".");
    await sleep(4000);
  }
  console.log("\n🔓 revealing");
  console.log(await call({ key: env.fighterKey, func: "Reveal", args: [matchId, moves, salt] }));
  console.log(`status: ${await qeval(env.realm, `MatchStatus(${matchId})`)}`);
}

// CLI: tsx worker.ts <matchId> <opponentPkgPath>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, opp] = process.argv.slice(2);
  if (!id || !opp) {
    console.error("usage: tsx worker.ts <matchId> <opponentPkgPath>");
    process.exit(1);
  }
  await runMatchTurn(Number(id), opp);
}
