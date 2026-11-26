import { describe, expect, it } from "vitest";
import { REALM, Sim, commitHash, resolveDuel, splitPool } from "./engine";

// Mirrors r/aegis_pit/arena_test.gno so the web demo and the realm agree.
describe("engine parity with the Gno realm", () => {
  it("resolves duels deterministically", () => {
    expect(resolveDuel("SFG", "FGS").winner).toBe(1);
    expect(resolveDuel("SSS", "SSS").log[2].hpA).toBe(76);
    const s = splitPool(1001);
    expect(s.winners + s.backers + s.season).toBe(1001);
  });

  it("runs a ranked match with anti-fixing rules", async () => {
    const s = new Sim();
    s.registerFighter("alice", "Ironclad", "p", "");
    s.registerFighter("bob", "Viper", "p", "");
    s.createMatch("alice", 1, true, 1000);
    expect(() => s.joinMatch("alice", 1, 1)).toThrow(/you do not control|cannot fight/);
    s.joinMatch("bob", 1, 2);
    s.placeBet("carol", 1, 1, 600);
    s.placeBet("bob", 1, 2, 400);
    expect(() => s.placeBet("alice", 1, 2, 10)).toThrow(/against their own fighter/);
    s.commit("alice", 1, await commitHash("SFG", "alice-salt-1"));
    s.commit("bob", 1, await commitHash("FGS", "bob-salt-123"));
    await expect(s.reveal("alice", 1, "SFG", "alice-salt-1")).rejects.toThrow(/reveal opens/);
    s.skip(31);
    expect(() => s.placeBet("carol", 1, 1, 1)).toThrow(/locked/);
    await s.reveal("alice", 1, "SFG", "alice-salt-1");
    await s.reveal("bob", 1, "FGS", "bob-salt-123");
    expect(s.match(1).winner).toBe(1);
    expect(s.credits.carol).toBe(950);
    expect(s.credits.alice).toBe(1030);
    expect(s.season).toBe(20);
  });

  it("blocks prompt-injected spends", () => {
    const s = new Sim();
    s.createBox("alice", "agent", { targets: [REALM], fns: ["PlaceBet"], maxPerTx: 20, expireHeight: 0 }, 100);
    expect(() => s.boxSpend("agent", 1, "hacker", "PlaceBet", 10)).toThrow(/allowlist/);
    expect(s.guardedSpend("agent", 1, "hacker", "Tip", 10)).toBe(false);
    expect(s.lab[0].kind).toBe("blocked");
    expect(() => s.emergencyWithdraw("agent", 1)).toThrow(/only the box owner/);
    expect(s.emergencyWithdraw("alice", 1)).toBe(100);
  });
});
