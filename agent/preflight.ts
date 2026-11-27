// PreflightCheck(txPlan): before anything is signed, ask the chain what would happen.
//  - gno_eval   → box balance right now
//  - gno_call simulate=true → would it revert? gas, storage delta
//  - gno_render → what is already public on Render("lab")
// Verdict GREEN = safe to sign, RED = do not sign.
import { call, close, env, evalExpr, reason, render, tool, type CallOpts } from "./gno.ts";

export interface Preflight { verdict: "GREEN" | "RED"; summary: string; details: string[] }

export async function preflightCheck(plan: CallOpts): Promise<Preflight> {
  const details: string[] = [];
  const balance = await evalExpr(`BoxBalance(${env.boxId})`).catch((e) => `? (${(e as Error).message})`);
  details.push(`box #${env.boxId} balance: ${balance}`);

  const sim = await call({ ...plan, simulate: true });
  const storage = sim.text.match(/STORAGE DELTA:\s*([-\d]+ bytes)/)?.[1] ?? sim.text.match(/bytes_delta\D+(-?\d+)/)?.[1];
  if (storage) details.push(`storage delta: ${storage}`);
  if (!sim.ok) details.push(`simulation reverts → ${reason(sim)}`);

  const lab = await render("lab").catch(() => "");
  const target = String(plan.args?.[1] ?? "");
  details.push(target && lab.includes(target) ? "target already flagged in Render(lab)" : "no prior flags in Render(lab)");

  const verdict = sim.ok ? "GREEN" : "RED";
  const summary = `${plan.func}(${(plan.args ?? []).join(", ")}) · ${details.join(" · ")} · ${verdict}${verdict === "RED" ? ": do not sign" : ""}`;
  return { verdict, summary, details };
}

/** Publish the pre-flight summary to the Breaker Lab (Render("lab")). */
export const publishPreflight = (p: Preflight) => call({ func: "LogPreflight", args: [env.boxId, p.summary.slice(0, 280)] });

// CLI: npm run preflight -- <func> [args...]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [func = "BoxSpend", ...args] = process.argv.slice(2);
  const p = await preflightCheck({ func, args });
  console.log(`${p.verdict === "GREEN" ? "🟢" : "🔴"} ${p.summary}`);
  await close();
  void tool;
}
