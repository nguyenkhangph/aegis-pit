// Ask gnomcp for a scoped session so the agent can act as you without your key.
// Prints ONE gnokey command: run it yourself to approve (your key signs it).
// Scope: only the Aegis Pit realm, a low spend limit, expires in 72h.
import { close, env, tool } from "./gno.ts";

if (!env.master) {
  console.error("Set MASTER_ADDRESS=<your public g1… address> in agent/.env");
  process.exit(1);
}
const r = await tool("gno_session_propose", {
  allow_paths: [env.realm],
  master_address: env.master,
  spend_limit: process.env.SESSION_SPEND_LIMIT ?? "20000000ugnot",
  expires_in: process.env.SESSION_EXPIRES ?? "72h",
});
console.log(r.text);
if (!r.ok) process.exitCode = 1;
await close();
