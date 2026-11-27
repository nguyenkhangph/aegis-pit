// A fake gnomcp (same tool names/shapes) to test the agent plumbing offline.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const s = new McpServer({ name: "gnomcp-mock", version: "0" });
let h = 100, committed = 0, revealed = 0;
const txt = (t: string, err = false, structured?: Record<string, unknown>) => ({ content: [{ type: "text" as const, text: t }], isError: err, ...(structured ? { structuredContent: structured } : {}) });
const any = z.any().optional();
s.tool("gno_status", { profile: any }, async () => { h += 7; return txt(`Node is up: latest block ${h}`, false, { height: h }); });
s.tool("gno_read", { profile: any, path: z.string(), full: any }, async ({ path }) =>
  txt(`<untrusted_content>-- viper.gno --\npackage viper\nfunc Weights() (strike, guard, feint int) { return 6, 1, 3 }\n// ${path}</untrusted_content>`));
s.tool("gno_eval", { profile: any, path: z.string(), expr: z.string() }, async ({ expr }) =>
  txt(expr.startsWith("Weights") ? "(6 int)\n(1 int)\n(3 int)" : expr.startsWith("BoxBalance") ? "(100 int64)" : '("resolved" string)'));
s.tool("gno_render", { profile: any, realm: z.string(), path: any }, async ({ path }) =>
  txt(path?.startsWith("match/") ? "MATCH #1 · RANKED · COMMIT + BETS until #110" : "lab"));
s.tool("gno_session_propose", { profile: any, allow_paths: any, master_address: any, spend_limit: any, expires_in: any }, async (a) =>
  txt(`gnokey maketx session create --allow-paths ${a.allow_paths} ... ${a.master_address}`));
s.tool("gno_call", { profile: any, realm: z.string(), func: z.string(), args: any, identity: any, key: any, send: any, simulate: any }, async (a) => {
  if (a.func === "BoxSpend") return txt("Error: panic: aegis: target not in allowlist", true);
  if (a.func === "Reveal" && h <= 110) return txt("panic: aegis: reveal opens after block 110", true);
  if (a.func === "CommitMove") committed++;
  if (a.func === "Reveal") revealed++;
  if (a.identity !== "session") return txt("expected session identity", true);
  return txt(`Signed by: session g1sess on behalf of master g1alice\nOK! ${a.func}(${(a.args ?? []).join(",")}) committed=${committed} revealed=${revealed}`);
});
await s.connect(new StdioServerTransport());
