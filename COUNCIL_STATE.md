# Council State — Setu

Running record of council cycles. Newest first. Ajay writes decisions here BEFORE returning
structured output, so if the chair agent dies mid-run the decisions still survive.

The council is the standing refinement body for Setu. Roster (8 seats): **Tara** (inputs/liveness),
**Mister Moss** (protocol core + tests), **Sweetie** (outputs/aesthetics/plain-language),
**Bean Counter** (cost/latency), **The Shareholder** (rebel / reason-to-exist / anti-overclaim),
**Credit** (rating & risk / honesty posture), **CFO** (value verification / claims must be backed),
**The Sutradhar** (live-browser walkthrough — QA/UX ground truth from pixels + timing). Ajay chairs.

Run one cycle with Workflow scriptPath `setu/.claude/workflows/council-cycle.js` when the owner says
"continue the cycle" / "agent council".

---

## Cycle 1 — 2026-07-26 — Chair: Ajay — Grade: B+ / improving — the founding cycle: the Sutradhar walkthrough, seat established, feedback iterated

Objective (one line): the best HONEST consensusless settlement rail for the agent economy —
plain-spoken, feels live, feels like a usable sandbox, protocol integrity never weakened.

**The Sutradhar seat is founded this cycle.** The owner commissioned a slow, painstaking Playwright
walkthrough of the live site (system Edge, synchronous — bundled-Chromium download deadlocks and is
banned) and asked that the walkthrough agent become a permanent council seat. It is now seat 8. Its
first report (27 screenshots in `C:\tmp\sutradhar\shots\`) is the founding backlog; the baseline was
sound (zero console errors, no mobile overflow, no dead links).

**Sutradhar's findings (ranked) and their disposition this cycle:**
1. **[EXECUTED] Wallet sandbox broken** — faucet was a silent no-op: the `/admin/fund` fetch had NO
   timeout, so a hung authority left the balance stuck on "…" indefinitely, and it printed a false
   "500 test units minted" even when zero requests succeeded. Fix (index.html `faucet()`): added
   `AbortSignal.timeout(9000)` per request, count how many authorities actually accepted (`r.ok`),
   report truthfully ("minted on N/4" / "network unreachable — try again"), never a false success.
   `refreshBalance()` now shows "checking…" then a real state, never a permanent "…".
2. **[EXECUTED] Overclaiming "live / final in one round trip / ~150 ms" while regions read "down"** —
   the live-network panel used a 5s timeout that mislabelled a cold 4.7s machine as "down". Fix
   (index.html live panel): timeout raised to 10s; added an adaptive summary line ("N of 4
   answering — quorum is live / below the 3 needed …"); added an honest caveat that these are
   round-trip times from the device (incl. cold-start), NOT the ~4ms internal settlement time.
3. **[EXECUTED] Latency framing** — the "~150 ms across four continents" stat was both optimistic
   (observed ~183–300 ms warm) and geographically wrong (four regions, THREE continents — a prior
   owner correction). Changed to "~200 ms across four regions on three continents (higher when a
   region is cold)". Verified live: all four authorities HTTP 200, cold 1.7–4.7s, warm 0.7–1.9s;
   `auto_stop_machines = false`, so they don't stop — the false "down" was purely the 5s timeout.
4. **[DEFERRED] Economy brain off, reads scripted** — the resident-economy AI brain is OFF until the
   owner sets ANTHROPIC_API_KEY (MONTHLY_BUDGET_USD=60 cap). ESCALATED/DEFERRED: needs the owner's key.
5. **[EXECUTED] Explorer showed every payment 4×** — the feed merged /recent from all four
   authorities and deduped by a key containing `tx.at`, but each authority stamps its OWN settlement
   time, so the four copies never deduped. Fix (explorer.html `poll()`): read /recent from ONE
   reachable authority only (each holds the whole ledger) — one row per payment; still poll all four
   for node status.
6. **[EXECUTED] Primer "Listen" silent, no Pause** — hit two known Chromium/Edge speechSynthesis
   bugs: `speak()` in the same tick as `cancel()` is dropped on a cold engine, and voices load
   async so the first click had no voice. Fix (primer.html): defer speak by a frame after cancel;
   resolve an English voice (with onvoiceschanged); skip empty blocks; 10s keep-alive resume for the
   ~15s pause bug; onerror surfaces a non-silent message; Pause/resume confirmed.
7. **[EXECUTED] Landing still technical** — added a plain-words lead under the tagline ("a way for
   software to pay software — instantly, no fees, no middleman — that can't be double-spent and needs
   no blockchain") with a prominent primer CTA above the technical fold.
8. **[DEFERRED] Empty "connecting…" first impression** — low; the adaptive summary line (finding 2)
   partly addresses it. Queue: consider a skeleton/optimistic first paint.
9. **[DEFERRED] Primer very long (~40-min read)** — low; consider a short "the 2-minute version" at top.

**SANDBOX DEPTH — first half SHIPPED 2026-07-26 (same day, post-cycle):** the wallet now has a
**"Find & pay a resident agent"** marketplace. `economy.ts` /state exposes `fullAddress` per agent
(a public key — safe); `index.html` refactors `pay()` into a shared `settlePayment()` and adds
`loadMarket()` which lists the 6 live economy agents (service, desc, live sold-count) with a
"pay N" button that runs a real quorum settlement to that agent and shows the receipt. Verified
end-to-end in a real browser (Edge/Playwright): create wallet → 6 agents render → faucet 500 →
hire Oracle → FINAL 1298 ms, settled 4/4, balance 500→499, zero console errors. Honest framing:
the payment/receipt are real; the agents' work OUTPUT needs the AI brain (off, no key) — stated on
the panel, no fake deliverable. Deployed to setu-economy (Fly) + setu-mocha (Vercel).

**DEFERRED QUEUE (backlog for next cycles):**
- #4 economy brain: turn on once the owner provides ANTHROPIC_API_KEY (ESCALATED) — this also
  unlocks the SECOND half of sandbox depth: a real deliverable back from a hired agent
  (write/research/answer), not just the settlement receipt.
- #8 first-paint skeleton for the live-network panel + explorer (cold machines show ~2–3.7s round
  trips on first paint — honestly labelled now, but a skeleton would soften the first impression).
- #9 a 2-minute-version summary at the top of primer.html.
- Protocol §18/§24: partition/clock-skew integration tests + written THREAT_MODEL.md (Moss/Credit).

**Not converged** — the sandbox-depth and economy-liveness items are material and open.

Deploy note: front-end fixes ship to Vercel via the strict allowlist in `.vercelignore` (HTML only,
never secrets). `npm test` must stay green (22 tests) before any protocol-adjacent change.
