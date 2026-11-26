import { useState } from "react";

const RPC = import.meta.env.VITE_GNO_RPC ?? "https://rpc.onyx.testnets.gno.land";
const GNOWEB = import.meta.env.VITE_GNOWEB ?? "https://onyx.testnets.gno.land";
const DEFAULT_REALM = import.meta.env.VITE_REALM_PATH ?? "gno.land/r/aegispit/aegis_pit";

const toHex = (s: string) => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, "0")).join("");

function b64ToUtf8(b64: string) {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// Calls vm/qrender exactly like gnoweb does, straight from the browser.
export async function qrender(realm: string, path: string): Promise<string> {
  const url = `${RPC}/abci_query?path=%22vm/qrender%22&data=0x${toHex(`${realm}:${path}`)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const j = await res.json();
  const base = j?.result?.response?.ResponseBase;
  if (base?.Error) throw new Error(base?.Log || JSON.stringify(base.Error));
  if (!base?.Data) throw new Error("empty response");
  return b64ToUtf8(base.Data);
}

// Very small markdown → JSX renderer: headings, images (SVG data URIs), tables, paragraphs.
function Md({ src }: { src: string }) {
  const lines = src.split("\n");
  return (
    <div className="md">
      {lines.map((l, i) => {
        const imgs = [...l.matchAll(/!\[([^\]]*)\]\((data:image\/svg\+xml;base64,[^)]+)\)/g)];
        if (imgs.length) return <p key={i}>{imgs.map((m, k) => <img key={k} alt={m[1]} src={m[2]} />)}</p>;
        if (l.startsWith("### ")) return <h5 key={i}>{l.slice(4)}</h5>;
        if (l.startsWith("## ")) return <h4 key={i}>{l.slice(3)}</h4>;
        if (l.startsWith("# ")) return <h3 key={i}>{l.slice(2)}</h3>;
        if (/^\|[-| ]+\|$/.test(l)) return null;
        if (l.startsWith("|")) return <div key={i} className="mdrow">{l.split("|").slice(1, -1).map((c, k) => <span key={k}>{c.replace(/\*\*/g, "").trim()}</span>)}</div>;
        if (!l.trim()) return null;
        return <p key={i}>{l.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")}</p>;
      })}
    </div>
  );
}

export function LiveTab() {
  const [realm, setRealm] = useState(DEFAULT_REALM);
  const [path, setPath] = useState("");
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true); setErr(null); setOut(null);
    try { setOut(await qrender(realm, path)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  const webUrl = `${GNOWEB}${realm.replace("gno.land", "")}${path ? ":" + path : ""}`;

  return (
    <div>
      <h3>Live on Onyx testnet</h3>
      <p className="muted">Reads the deployed realm with <code>vm/qrender</code> over the public RPC — the same call gnoweb makes. Nothing here is simulated.</p>
      <div className="form live">
        <label>realm<input value={realm} onChange={(e) => setRealm(e.target.value.trim())} /></label>
        <label>path<select value={path} onChange={(e) => setPath(e.target.value)}>
          <option value="">"" lobby</option><option value="match/1">match/1</option><option value="fighters">fighters</option><option value="lab">lab</option><option value="exit">exit</option>
        </select></label>
        <button className="btn small primary" onClick={load} disabled={loading}>{loading ? "Querying…" : "qrender"}</button>
        <a className="btn small" href={webUrl} target="_blank" rel="noreferrer">Open in gnoweb ↗</a>
      </div>
      {err && <div className="empty">Could not read <code>{realm}</code>: {err}.<br />If the realm isn't deployed yet, run <code>scripts/deploy-onyx.sh</code>, then set <code>VITE_REALM_PATH</code> on Vercel to your address-namespaced path.</div>}
      {out && <Md src={out} />}
    </div>
  );
}
