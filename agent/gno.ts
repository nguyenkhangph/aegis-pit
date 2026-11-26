// Thin client for Gno.land: read-only RPC queries (the same ones gnomcp and
// gnoweb use) + transaction signing delegated to the local `gnokey` keybase.
// The agent process never holds a private key.
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

// Minimal .env loader (no dependency).
if (existsSync(new URL("./.env", import.meta.url))) {
  for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

export const env = {
  rpc: process.env.GNO_RPC ?? "https://rpc.onyx.testnets.gno.land:443",
  chainId: process.env.GNO_CHAIN_ID ?? "onyx-1",
  realm: process.env.AEGIS_REALM ?? "gno.land/r/aegispit/aegis_pit",
  agentKey: process.env.AGENT_KEY ?? "agent",
  fighterKey: process.env.FIGHTER_KEY ?? "alice",
  boxId: Number(process.env.BOX_ID ?? 1),
};

const httpRpc = () => env.rpc.replace(/:443$/, "");
const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");

/** Raw ABCI query, e.g. vm/qrender, vm/qeval, vm/qfile, vm/qstorage. */
export async function abci(path: string, data: string): Promise<string> {
  const url = `${httpRpc()}/abci_query?path=%22${encodeURIComponent(path)}%22&data=0x${hex(data)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`RPC ${res.status} for ${path}`);
  const j = (await res.json()) as any;
  const base = j?.result?.response?.ResponseBase;
  if (base?.Error) throw new Error(`${path}: ${base.Log || JSON.stringify(base.Error)}`);
  return Buffer.from(base?.Data ?? "", "base64").toString("utf8");
}

export const qrender = (pkg: string, path = "") => abci("vm/qrender", `${pkg}:${path}`);
export const qeval = (pkg: string, expr: string) => abci("vm/qeval", `${pkg}.${expr}`);
export const qfile = (pkgOrFile: string) => abci("vm/qfile", pkgOrFile);
export const qstorage = (pkg: string) => abci("vm/qstorage", pkg);

/** Read every .gno file of a public package (Gno source is always on-chain). */
export async function readSource(pkgPath: string): Promise<Record<string, string>> {
  const files = (await qfile(pkgPath)).split("\n").filter((f) => f.endsWith(".gno") && !f.endsWith("_test.gno"));
  const out: Record<string, string> = {};
  for (const f of files) out[f] = await qfile(`${pkgPath}/${f}`);
  return out;
}

export interface CallOpts { key: string; func: string; args?: (string | number | boolean)[]; send?: number; gasWanted?: number }

/** Sign and broadcast a MsgCall with the local gnokey keybase. */
export async function call({ key, func, args = [], send, gasWanted = 8_000_000 }: CallOpts): Promise<string> {
  const argv = ["maketx", "call", "-pkgpath", env.realm, "-func", func];
  for (const a of args) argv.push("-args", String(a));
  if (send) argv.push("-send", `${send}ugnot`);
  argv.push("-gas-fee", "1000000ugnot", "-gas-wanted", String(gasWanted), "-broadcast", "-chainid", env.chainId, "-remote", env.rpc, key);
  const { stdout, stderr } = await run("gnokey", argv, { env: process.env });
  return (stdout + stderr).trim();
}

/** Same as gnokey's `-simulate only`: dry-run a tx to see if it would revert. */
export async function simulate(opts: CallOpts): Promise<{ ok: boolean; out: string }> {
  const argv = ["maketx", "call", "-pkgpath", env.realm, "-func", opts.func];
  for (const a of opts.args ?? []) argv.push("-args", String(a));
  if (opts.send) argv.push("-send", `${opts.send}ugnot`);
  argv.push("-gas-fee", "1000000ugnot", "-gas-wanted", "8000000", "-simulate", "only", "-broadcast", "-chainid", env.chainId, "-remote", env.rpc, opts.key);
  try {
    const { stdout, stderr } = await run("gnokey", argv);
    return { ok: true, out: (stdout + stderr).trim() };
  } catch (e: any) {
    return { ok: false, out: String(e?.stderr || e?.message || e).trim() };
  }
}

export const commitHash = (moves: string, salt: string) => createHash("sha256").update(`${moves}:${salt}`).digest("hex");
export const newSalt = () => randomBytes(12).toString("hex");
