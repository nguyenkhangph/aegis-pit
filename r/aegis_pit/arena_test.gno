package aegis_pit

import (
	"chain"
	"strings"
	"testing"

	core "gno.land/p/aegispit/aegis_core"
	"gno.land/p/nt/testutils/v0"
	"gno.land/p/nt/uassert/v0"
)

var (
	alice   = testutils.TestAddress("alice")  // owns fighter A
	bob     = testutils.TestAddress("bob")    // owns fighter B
	carol   = testutils.TestAddress("carol")  // bettor
	dave    = testutils.TestAddress("dave")   // bettor
	agentK  = testutils.TestAddress("agent")  // AI agent key
	hacker  = testutils.TestAddress("hacker") // injected recipient
	tavern  = testutils.TestAddress("tavern") // allowed recipient
	pkgAddr = chain.PackageAddress("gno.land/r/aegispit/aegis_pit")
)

func setupFighters(cur realm) (int, int) {
	testing.SetRealm(testing.NewUserRealm(alice))
	a := RegisterFighter(cross(cur), "Ironclad", "gno.land/r/aegispit/ironclad", 1000)
	testing.SetRealm(testing.NewUserRealm(bob))
	b := RegisterFighter(cross(cur), "Viper", "gno.land/r/aegispit/viper", 1000)
	return a, b
}

func TestRankedMatchFullFlow(cur realm, t *testing.T) {
	testing.IssueCoins(pkgAddr, chain.Coins{{"ugnot", 1_000_000}})
	fa, fb := setupFighters(cur)

	testing.SetRealm(testing.NewUserRealm(alice))
	testing.SetOriginSend(chain.Coins{{"ugnot", 1000}})
	mid := CreateMatch(cross(cur), fa, true)

	// same owner cannot join own match
	uassert.AbortsContains(t, cur, "cannot fight yourself", func() {
		testing.SetRealm(testing.NewUserRealm(alice))
		testing.SetOriginSend(chain.Coins{{"ugnot", 1000}})
		JoinMatch(cross(cur), mid, fa)
	})
	// wrong bond
	uassert.AbortsContains(t, cur, "bond must equal", func() {
		testing.SetRealm(testing.NewUserRealm(bob))
		testing.SetOriginSend(chain.Coins{{"ugnot", 999}})
		JoinMatch(cross(cur), mid, fb)
	})
	testing.SetRealm(testing.NewUserRealm(bob))
	testing.SetOriginSend(chain.Coins{{"ugnot", 1000}})
	JoinMatch(cross(cur), mid, fb)
	uassert.Equal(t, StatusLive, MatchStatus(mid))

	// bets
	testing.SetRealm(testing.NewUserRealm(carol))
	testing.SetOriginSend(chain.Coins{{"ugnot", 600}})
	PlaceBet(cross(cur), mid, 1)
	testing.SetRealm(testing.NewUserRealm(dave))
	testing.SetOriginSend(chain.Coins{{"ugnot", 400}})
	PlaceBet(cross(cur), mid, 2)

	// anti match-fixing: alice cannot bet against her own fighter
	uassert.AbortsContains(t, cur, "against their own fighter", func() {
		testing.SetRealm(testing.NewUserRealm(alice))
		testing.SetOriginSend(chain.Coins{{"ugnot", 10}})
		PlaceBet(cross(cur), mid, 2)
	})

	// commits
	testing.SetOriginSend(chain.Coins{})
	testing.SetRealm(testing.NewUserRealm(alice))
	CommitMove(cross(cur), mid, core.CommitHash("SFG", "alice-salt-1"))
	testing.SetRealm(testing.NewUserRealm(bob))
	CommitMove(cross(cur), mid, core.CommitHash("FGS", "bob-salt-123"))
	uassert.AbortsContains(t, cur, "already committed", func() {
		testing.SetRealm(testing.NewUserRealm(bob))
		CommitMove(cross(cur), mid, core.CommitHash("SSS", "bob-salt-123"))
	})

	// reveal before the lock is refused (nobody sees moves while bets are open)
	uassert.AbortsContains(t, cur, "reveal opens after block", func() {
		testing.SetRealm(testing.NewUserRealm(alice))
		Reveal(cross(cur), mid, "SFG", "alice-salt-1")
	})

	testing.SkipHeights(CommitWindow + 1)

	// betting is locked at the commit deadline
	uassert.AbortsContains(t, cur, "betting is locked", func() {
		testing.SetRealm(testing.NewUserRealm(carol))
		testing.SetOriginSend(chain.Coins{{"ugnot", 100}})
		PlaceBet(cross(cur), mid, 1)
	})
	testing.SetOriginSend(chain.Coins{})

	// wrong salt
	uassert.AbortsContains(t, cur, "does not match", func() {
		testing.SetRealm(testing.NewUserRealm(alice))
		Reveal(cross(cur), mid, "SFG", "wrong-salt-x")
	})
	testing.SetRealm(testing.NewUserRealm(alice))
	Reveal(cross(cur), mid, "SFG", "alice-salt-1")
	testing.SetRealm(testing.NewUserRealm(bob))
	Reveal(cross(cur), mid, "FGS", "bob-salt-123")

	uassert.Equal(t, StatusResolved, MatchStatus(mid))
	uassert.Equal(t, 1, MatchWinner(mid))

	// pool 1000: carol (only winner bettor) gets 950, backers 30, season 20
	uassert.Equal(t, int64(950), CreditOf(carol))
	uassert.Equal(t, int64(0), CreditOf(dave))
	uassert.Equal(t, int64(1000), CreditOf(alice)) // bond back
	uassert.Equal(t, int64(1000), CreditOf(bob))   // bond back
	uassert.Equal(t, int64(30), BackerPending(fa, alice))
	uassert.Equal(t, int64(20), SeasonFund())

	// trust only from ranked money
	uassert.True(t, TrustScore(alice) > TrustScore(bob))

	// backer token transfer settles dividends first
	testing.SetRealm(testing.NewUserRealm(alice))
	TransferBacker(cross(cur), fa, carol, 500)
	uassert.Equal(t, int64(1030), CreditOf(alice))
	uassert.Equal(t, int64(500), BackerBalance(fa, carol))
	uassert.Equal(t, int64(0), BackerPending(fa, carol))

	// claim pays out
	testing.SetRealm(testing.NewUserRealm(carol))
	got := Claim(cross(cur))
	uassert.Equal(t, int64(950), got)
	uassert.Equal(t, int64(0), CreditOf(carol))
	uassert.AbortsContains(t, cur, "nothing to claim", func() {
		testing.SetRealm(testing.NewUserRealm(carol))
		Claim(cross(cur))
	})

	uassert.True(t, strings.Contains(Render("match/1"), "Combat log"))
	uassert.True(t, strings.Contains(Render("fighters"), "First Blood"))
}

func TestSlashNoReveal(cur realm, t *testing.T) {
	testing.IssueCoins(pkgAddr, chain.Coins{{"ugnot", 1_000_000}})
	fa, fb := setupFighters(cur)
	testing.SetRealm(testing.NewUserRealm(alice))
	testing.SetOriginSend(chain.Coins{{"ugnot", 2000}})
	mid := CreateMatch(cross(cur), fa, true)
	testing.SetRealm(testing.NewUserRealm(bob))
	testing.SetOriginSend(chain.Coins{{"ugnot", 2000}})
	JoinMatch(cross(cur), mid, fb)
	testing.SetRealm(testing.NewUserRealm(carol))
	testing.SetOriginSend(chain.Coins{{"ugnot", 300}})
	PlaceBet(cross(cur), mid, 2)
	testing.SetOriginSend(chain.Coins{})

	testing.SetRealm(testing.NewUserRealm(alice))
	CommitMove(cross(cur), mid, core.CommitHash("SSS", "salt-alice"))
	testing.SetRealm(testing.NewUserRealm(bob))
	CommitMove(cross(cur), mid, core.CommitHash("GGG", "salt-bob-1"))
	testing.SkipHeights(CommitWindow + 1)
	testing.SetRealm(testing.NewUserRealm(alice))
	Reveal(cross(cur), mid, "SSS", "salt-alice")
	// bob sees he would lose and refuses to reveal

	uassert.AbortsContains(t, cur, "nothing to slash yet", func() {
		testing.SetRealm(testing.NewUserRealm(dave))
		SlashNoReveal(cross(cur), mid)
	})
	testing.SkipHeights(RevealWindow + 1)
	before := CreditOf(alice)
	testing.SetRealm(testing.NewUserRealm(dave))
	SlashNoReveal(cross(cur), mid)

	uassert.Equal(t, StatusForfeit, MatchStatus(mid))
	uassert.Equal(t, before+4000, CreditOf(alice)) // both bonds
	uassert.Equal(t, int64(300), CreditOf(carol))  // bettors refunded
	uassert.True(t, strings.Contains(Render("lab"), "never revealed"))
}

func TestFriendlyMatchNoBets(cur realm, t *testing.T) {
	fa, fb := setupFighters(cur)
	testing.SetRealm(testing.NewUserRealm(alice))
	testing.SetOriginSend(chain.Coins{{"ugnot", 1000}})
	mid := CreateMatch(cross(cur), fa, false)
	testing.SetRealm(testing.NewUserRealm(bob))
	testing.SetOriginSend(chain.Coins{{"ugnot", 1000}})
	JoinMatch(cross(cur), mid, fb)
	uassert.AbortsContains(t, cur, "no betting", func() {
		testing.SetRealm(testing.NewUserRealm(carol))
		testing.SetOriginSend(chain.Coins{{"ugnot", 10}})
		PlaceBet(cross(cur), mid, 1)
	})
}

func TestBoxPolicyAndExit(cur realm, t *testing.T) {
	testing.IssueCoins(pkgAddr, chain.Coins{{"ugnot", 1_000_000}})
	testing.SetRealm(testing.NewUserRealm(alice))
	testing.SetOriginSend(chain.Coins{{"ugnot", 100}})
	box := CreateBox(cross(cur), agentK, string(tavern), "Tip", 30, 0)
	testing.SetOriginSend(chain.Coins{})
	uassert.Equal(t, int64(100), BoxBalance(box))

	// prompt-injected agent tries to send to a hacker: hard revert
	uassert.AbortsContains(t, cur, "target not in allowlist", func() {
		testing.SetRealm(testing.NewUserRealm(agentK))
		BoxSpend(cross(cur), box, hacker, "Tip", 10)
	})
	// over cap
	uassert.AbortsContains(t, cur, "exceeds per-tx cap", func() {
		testing.SetRealm(testing.NewUserRealm(agentK))
		BoxSpend(cross(cur), box, tavern, "Tip", 31)
	})
	// wrong fn
	uassert.AbortsContains(t, cur, "function not in allowlist", func() {
		testing.SetRealm(testing.NewUserRealm(agentK))
		BoxSpend(cross(cur), box, tavern, "Drain", 1)
	})
	// stranger
	uassert.AbortsContains(t, cur, "not the box owner", func() {
		testing.SetRealm(testing.NewUserRealm(hacker))
		BoxSpend(cross(cur), box, tavern, "Tip", 1)
	})

	// soft variant logs to the lab and moves nothing
	testing.SetRealm(testing.NewUserRealm(agentK))
	ok := GuardedSpend(cross(cur), box, hacker, "Tip", 10)
	uassert.False(t, ok)
	uassert.Equal(t, int64(100), BoxBalance(box))
	uassert.True(t, strings.Contains(Render("lab"), "target not in allowlist"))

	// legit spend
	testing.SetRealm(testing.NewUserRealm(agentK))
	BoxSpend(cross(cur), box, tavern, "Tip", 20)
	uassert.Equal(t, int64(80), BoxBalance(box))

	// agent cannot exit; owner can
	uassert.AbortsContains(t, cur, "only the box owner", func() {
		testing.SetRealm(testing.NewUserRealm(agentK))
		EmergencyWithdraw(cross(cur), box)
	})
	testing.SetRealm(testing.NewUserRealm(alice))
	got := EmergencyWithdraw(cross(cur), box)
	uassert.Equal(t, int64(80), got)
	uassert.Equal(t, int64(0), BoxBalance(box))
	uassert.AbortsContains(t, cur, "box closed", func() {
		testing.SetRealm(testing.NewUserRealm(agentK))
		BoxSpend(cross(cur), box, tavern, "Tip", 1)
	})
}

func TestBoxBet(cur realm, t *testing.T) {
	testing.IssueCoins(pkgAddr, chain.Coins{{"ugnot", 1_000_000}})
	fa, fb := setupFighters(cur)
	testing.SetRealm(testing.NewUserRealm(alice))
	testing.SetOriginSend(chain.Coins{{"ugnot", 1000}})
	mid := CreateMatch(cross(cur), fa, true)
	testing.SetRealm(testing.NewUserRealm(bob))
	testing.SetOriginSend(chain.Coins{{"ugnot", 1000}})
	JoinMatch(cross(cur), mid, fb)

	testing.SetRealm(testing.NewUserRealm(carol))
	testing.SetOriginSend(chain.Coins{{"ugnot", 100}})
	box := CreateBox(cross(cur), agentK, string(pkgAddr), "PlaceBet", 20, 0)
	testing.SetOriginSend(chain.Coins{})
	testing.SetRealm(testing.NewUserRealm(agentK))
	BoxBet(cross(cur), box, mid, 1, 20)
	uassert.Equal(t, int64(80), BoxBalance(box))
	uassert.AbortsContains(t, cur, "exceeds per-tx cap", func() {
		testing.SetRealm(testing.NewUserRealm(agentK))
		BoxBet(cross(cur), box, mid, 1, 21)
	})
}

func TestRenderRoutes(cur realm, t *testing.T) {
	uassert.True(t, strings.Contains(Render(""), "Aegis Pit"))
	uassert.True(t, strings.Contains(Render("exit"), "EmergencyWithdraw"))
	uassert.True(t, strings.Contains(Render("nope"), "404"))
	uassert.True(t, strings.Contains(Render("match/999"), "404"))
}
