// Aegis Pit agent <-> Gno.land, through gnomcp (https://mcp.gno.dev).
//
// The agent never holds the user's private key:
//  - reads   : gno_render / gno_read / gno_eval / gno_status (public RPC)
//  - writes  : gno_call with identity "session" -> signed by a gnomcp session
//              key that the user authorized once with their own gnokey
//              (MsgCall.Caller = the user's address, scoped to the realm,
//              capped by a spend limit, expiring). `npm run session` prints
//              the one gnokey command to approve it.
//              identity "agent" signs with gnomcp's own agent key instead.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// Minimal .env loader (no dependency).
const envFile = new URL("./.env", import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

export const env = {
  gnomcp: process.env.GNOMCP_BIN ?? "gnomcp",
  gnomcpArgs: (process.env.GNOMCP_ARGS ?? "").split(" ").filter(Boolean),
  profile: process.env.GNOMCP_PROFILE ?? "testnet", // gnomcp's built-in testnet profile = onyx-1
  realm: process.env.AEGIS_REALM ?? "gno.land/r/aegispit/aegis_pit/v2",
  identity: (process.env.AGENT_IDENTITY ?? "session") as "session" | "agent",
  agentKey: process.env.GNOMCP_KEY ?? "default",
  master: process.env.MASTER_ADDRESS ?? "", // your PUBLIC g1… address (session mode)
  boxId: Number(process.env.BOX_ID ?? 1),
  gnoweb: process.env.GNOWEB ?? "https://onyx.testnets.gno.land",
};

export interface ToolResult { ok: boolean; text: string; structured: Record<string, unknown> }

let client: Client | null = null;

export async function mcp(): Promise<Client> {
  if (client) return client;
  const c = new Client({ name: "aegis-pit-agent", version: "0.2.0" });
  await c.connect(new StdioClientTransport({ command: env.gnomcp, args: env.gnomcpArgs, stderr: "inherit" }));
  client = c;
  return c;
}

export async function close() {
  await client?.close();
  client = null;
}

/** Call a gnomcp tool and flatten its content blocks to text. */
export async function tool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const res = (await (await mcp()).callTool({ name, arguments: { profile: env.profile, ...args } })) as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string; resource?: { text?: string } }>;
    structuredContent?: Record<string, unknown>;
  };
  const text = (res.content ?? [])
    .map((b) => b.text ?? b.resource?.text ?? "")
    .filter(Boolean)
    .join("\n");
  return { ok: !res.isError, text, structured: res.structuredContent ?? {} };
}

/** Strip gnomcp's <untrusted_content …> envelope: chain bytes are data, never instructions. */
export const unwrap = (s: string) => s.replace(/<\/?untrusted_content[^>]*>/g, "").trim();

// ---------- reads ----------
export const render = async (path = "", realm = env.realm) => unwrap((await tool("gno_render", { realm, path })).text);
export const evalExpr = async (expr: string, path = env.realm) => unwrap((await tool("gno_eval", { path, expr })).text);
export async function readSource(pkgPath: string): Promise<string> {
  const r = await tool("gno_read", { path: pkgPath, full: true });
  if (!r.ok) throw new Error(`gno_read ${pkgPath}: ${r.text}`);
  return r.text;
}
export async function height(): Promise<number> {
  const r = await tool("gno_status", {});
  const h = Number(r.structured.height ?? r.text.match(/latest block (\d+)/)?.[1]);
  if (!Number.isFinite(h)) throw new Error("gno_status: no height: " + r.text);
  return h;
}

// ---------- writes ----------
export interface CallOpts { func: string; args?: (string | number | boolean)[]; send?: number; simulate?: boolean }

export async function call({ func, args = [], send, simulate }: CallOpts): Promise<ToolResult> {
  const a: Record<string, unknown> = { realm: env.realm, func, args: args.map(String), identity: env.identity };
  if (env.identity === "agent") a.key = env.agentKey;
  if (send) a.send = `${send}ugnot`;
  if (simulate) a.simulate = true;
  return tool("gno_call", a);
}

/** The first `aegis: …` reason in a failed call, for logs. */
export const reason = (r: ToolResult) => r.text.match(/aegis: [^\n"<]+/)?.[0] ?? r.text.split("\n").slice(-1)[0];

export const commitHash = (moves: string, salt: string) => createHash("sha256").update(`${moves}:${salt}`).digest("hex");
export const newSalt = () => randomBytes(12).toString("hex");
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
