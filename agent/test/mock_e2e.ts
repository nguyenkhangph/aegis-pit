// Offline test: runs the real worker + breaker code against a fake gnomcp
// that exposes the same tool names and result shapes.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

process.env.GNOMCP_BIN = process.execPath;
process.env.GNOMCP_ARGS = `--import tsx ${fileURLToPath(new URL("./mock_gnomcp.ts", import.meta.url))}`;
process.env.AGENT_IDENTITY = "session";
process.env.AEGIS_REALM = "gno.land/r/g1test/aegis_pit/v2";

const { close } = await import("../gno.ts");
const { chooseCounter, readOpponentSource, runMatchTurn } = await import("../worker.ts");
const { breakerDemo } = await import("../breaker_demo.ts");

const logs: string[] = [];
const log = (...a: unknown[]) => logs.push(a.join(" "));

const opp = await readOpponentSource("gno.land/r/g1bob/viper");
assert.deepEqual(opp.weights, [6, 1, 3]);
assert.equal(chooseCounter(opp.weights), "GSG"); // beat Strike, beat Feint, beat Strike

await runMatchTurn(1, "gno.land/r/g1bob/viper", log);
assert.ok(logs.some((l) => l.includes("committed")), "committed");
assert.ok(logs.some((l) => l.includes("revealed")), "revealed after lock");

logs.length = 0;
await breakerDemo(log);
const out = logs.join("\n");
assert.match(out, /🔴 preflight/);
assert.match(out, /refused ✔ +aegis: target not in allowlist/);
await close();
console.log("mock e2e OK\n" + out.split("\n").slice(0, 6).join("\n"));
