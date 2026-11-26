import { START_HP, type Match, type Sim } from "./engine";

const C = { bg: "#14110f", panel: "#221c17", gold: "#e8b44a", red: "#d9534f", teal: "#3fb6a8", text: "#f3e9dc", muted: "#9c8f80" };
const mono = "JetBrains Mono, ui-monospace, monospace";

function HpBar({ x, y, w, hp, fill }: { x: number; y: number; w: number; hp: number; fill: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={14} rx={4} fill={C.panel} />
      <rect x={x} y={y} width={(w * hp) / START_HP} height={14} rx={4} fill={fill} style={{ transition: "width .6s ease" }} />
      <text x={x + w / 2} y={y + 11} fontSize={11} fill={C.text} textAnchor="middle" fontFamily={mono}>{hp} HP</text>
    </g>
  );
}

export function phaseOf(m: Match, height: number) {
  if (m.status === "live") return height <= m.commitDeadline ? `COMMIT + BETS until #${m.commitDeadline}` : `REVEAL until #${m.revealDeadline}`;
  return m.status.toUpperCase();
}

export function MatchCard({ sim, m }: { sim: Sim; m: Match }) {
  const fa = sim.fighter(m.a);
  const nameB = m.b ? sim.fighter(m.b).name : "waiting…";
  let hpA = START_HP, hpB = START_HP;
  if (m.log.length) { const l = m.log[m.log.length - 1]; hpA = l.hpA; hpB = l.hpB; }
  if (m.status === "forfeit") { if (m.winner === 1) hpB = 0; else if (m.winner === 2) hpA = 0; else { hpA = 0; hpB = 0; } }
  const total = m.poolA + m.poolB;
  const wA = total ? (440 * m.poolA) / total : 220;
  const done = m.status === "resolved" || m.status === "forfeit";
  const verdict = m.winner === 1 ? `${fa.name} WINS` : m.winner === 2 ? `${nameB} WINS` : "DRAW";
  return (
    <svg viewBox="0 0 480 150" className="matchcard" role="img" aria-label={`Match ${m.id}`}>
      <rect width="100%" height="100%" rx={14} fill={C.bg} />
      <text x={20} y={30} fontSize={13} fill={C.muted} fontFamily={mono}>MATCH #{m.id} · {m.ranked ? "RANKED" : "FRIENDLY"} · {phaseOf(m, sim.height)}</text>
      <text x={20} y={62} fontSize={18} fill={C.gold} fontFamily={mono}>{fa.name}</text>
      <text x={460} y={62} fontSize={18} fill={C.teal} textAnchor="end" fontFamily={mono}>{nameB}</text>
      <text x={240} y={62} fontSize={16} fill={C.muted} textAnchor="middle" fontFamily={mono}>VS</text>
      <HpBar x={20} y={74} w={190} hp={hpA} fill={C.gold} />
      <HpBar x={270} y={74} w={190} hp={hpB} fill={C.teal} />
      <rect x={20} y={104} width={440} height={10} rx={4} fill={C.teal} />
      <rect x={20} y={104} width={wA} height={10} rx={4} fill={C.gold} style={{ transition: "width .6s ease" }} />
      <text x={20} y={134} fontSize={12} fill={C.text} fontFamily={mono}>{m.poolA} ugnot</text>
      <text x={460} y={134} fontSize={12} fill={C.text} textAnchor="end" fontFamily={mono}>{m.poolB} ugnot</text>
      {done && <text x={240} y={134} fontSize={13} fill={C.red} textAnchor="middle" fontFamily={mono}>{verdict}</text>}
    </svg>
  );
}

export function Badge({ name }: { name: string }) {
  const color = name === "Untouched" ? C.teal : name === "Giant Slayer" ? C.red : C.gold;
  return (
    <svg viewBox="0 0 80 88" width={64} height={70} role="img" aria-label={name}>
      <rect width="100%" height="100%" rx={14} fill={C.bg} />
      <circle cx={40} cy={34} r={24} fill={C.panel} stroke={color} strokeWidth={3} />
      <polygon points="40,18 45,30 58,31 48,39 51,52 40,45 29,52 32,39 22,31 35,30" fill={color} />
      <text x={40} y={78} fontSize={9} fill={C.text} textAnchor="middle" fontFamily={mono}>{name}</text>
    </svg>
  );
}

export function Shield({ size = 40 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <path d="M32 6 54 15v17c0 13-9.3 21.5-22 26C19.3 53.5 10 45 10 32V15z" fill="#1b1612" stroke={C.gold} strokeWidth={3.5} />
      <path d="M23 41 41 23M23 23l18 18" stroke={C.teal} strokeWidth={4} strokeLinecap="round" />
    </svg>
  );
}
