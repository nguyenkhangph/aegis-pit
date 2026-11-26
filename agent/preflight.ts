// PreflightCheck: before signing anything, ask the chain what would happen.
//  - vm/qeval    → current box balance / trust (read-only)
//  - simulate    → would the tx revert? (policy violations show up here)
//  - vm/qstorage → storage bytes + deposit locked by the realm
//  - vm/qrender  → what becomes public on gnoweb
// The verdict is GREEN (safe to sign) or RED (do not sign).
import { call, env, qeval, qrender, qstorage, simulate, type CallOpts } from "./gno.ts";

export interface Preflight { verdict: "GREEN" | "RED"; reasons: string[]; summary: string }

export async function preflightCheck(plan: CallOpts): Promise<Preflight> {
  const reasons: string[] = [];
  let balance = "?";
  try { balance = await qeval(env.realm, `BoxBalance(${env.boxId})`); } catch (e) { reasons.push(`qeval failed: ${(e as Error).message}`); }

  const sim = await simulate(plan);
  if (!sim.ok) {
    const why = sim.out.match(/aegis: [^\n"]+/)?.[0] ?? sim.out.split("\n").slice(-1)[0];
    reasons.push(`simulation reverts → ${why}`);
  }

  let storage = "?";
  try { storage = await qstorage(env.realm); } catch { /* optional */ }

  let exposes = "";
  try {
    const page = await qrender(env.realm, "lab");
    exposes = page.includes(String(plan.args?.[1] ?? "")) ? "target address will be public in Render(lab)" : "no new public data";
  } catch { /* optional */ }

  const verdict = reasons.some((r) => r.startsWith("simulation reverts")) ? "RED" : "GREEN";
  const summary = `${plan.func}(${(plan.args ?? []).join(", ")}) · box balance ${balance.trim()} · ${storage.trim()} · ${exposes} · ${verdict}${verdict === "RED" ? ": do not sign" : ""}`;
  return { verdict, reasons, summary };
}

/** Publish the pre-flight summary to the Breaker Lab (Render("lab")). */
export async function publishPreflight(p: Preflight) {
  return call({ key: env.agentKey, func: "LogPreflight", args: [env.boxId, p.summary.slice(0, 280)] });
}

// CLI: tsx preflight.ts <func> [args...]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [func = "BoxSpend", ...args] = process.argv.slice(2);
  const p = await preflightCheck({ key: env.agentKey, func, args });
  console.log(`\n${p.verdict === "GREEN" ? "🟢" : "🔴"} ${p.summary}`);
  for (const r of p.reasons) console.log("  -", r);
}
