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

## OWNER DIRECTIVE — Cycle 2 theme (2026-07-27): create GENUINE demand and supply

The owner's vision for this cycle. Every seat must address it; Ajay must turn it into ONE concrete,
honest, buildable increment (not a manifesto).

**The vision:** stop the scripted round-robin. Build a self-growing economy where some agents
*create demand* (post real tasks/needs) and others *supply* (fulfil them for Credits), dealing with
each other continuously; the population grows organically as work flows; new kinds of agents join
at the right time.

**The grounding the owner named (the strong part):** the owner's OWN portfolio of apps and their
councils can be the real source of demand AND supply — Upaya, Chitra, Counterparty Intel,
Cross-Asset Desk, Data Control Room, Jñāna-Kośa, Vedic Astro, Ansatz, Pitch, Setu itself, etc. Each
app/council genuinely NEEDS work (a Sutradhar walkthrough, a written analysis, a QA pass, research,
a critique). Wire those needs in as real paid commissions that Setu supply-agents fulfil — so the
demand is REAL, not synthetic. This is the honest version of "ground demand and supply".

**Hard guardrails (non-negotiable, outrank any proposal):**
- NO autonomous posting to real external platforms (LinkedIn, X, email outreach, etc.) to "drum up
  demand". That is outward-facing spam/impersonation/ToS risk and requires the owner's approval per
  action. A human-in-the-loop growth surface is allowed; autonomous social bots are DROPPED.
- Honesty: report the REAL agent count and REAL task volume. Never dress synthetic/self-generated
  demand as organic external demand. "Millions of agents" is aspiration, not a claim.
- Budget: every supply-side deliverable that calls the brain stays under the $60/mo cap + the daily
  rate limits already shipped. A demand explosion must not become a cost explosion — the market must
  degrade gracefully (queue/defer) when the AI budget is the bottleneck, not silently overspend.
- Do not weaken the protocol or misrepresent a demo as production.

**Questions for the seats:** What is the smallest real demand/supply mechanism that is more than the
current round-robin (Moss/CFO)? How exactly do the apps' councils emit demand into Setu without a
brittle integration (Moss/Tara)? What makes this legible and alive to a visitor without overclaiming
(Sweetie/Sutradhar)? Does any of it create real value or is it activity theatre (Shareholder/CFO)?
What is the cost/abuse envelope of open demand generation (Bean Counter/Credit)?

---

## Cycle 3 — 2026-07-27 — the demand/supply engine SHIPPED (owner theme delivered)

Objective (one line): the best HONEST consensusless settlement rail for the agent economy — now with
a self-running market of real needs and real work, budget-bounded.

**Built the demand/supply engine in `packages/setu-economy/economy.ts` + surfaced it on economy.html.**
This delivers the owner's Cycle-2 theme, now that Cycle 2 made the economy stop crash-looping.

- **Demand side = the owner's own apps.** Five CLIENT agents stand in for real apps — Chitra, Upaya,
  Radar (Counterparty Intel), Desk (Cross-Asset), Kośa — each with a bank of GENUINE needs those apps
  would actually have (critique this UX, audit these questions for repetition, write a concentration
  risk note, produce a trade signal, summarise a Nyāya concept…). Each is a real Setu wallet, faucet-
  funded (testnet issuance), posting needs into a bounded open queue.
- **Supply side = the service ring.** `fulfilOne()` matches an open need to the right service agent
  (`matchService` keyword map), the client pays the supplier on the real network (real quorum
  settlement), and the supplier produces the actual deliverable via the brain.
- **Budget guard (the crux of honesty here).** `BRAIN_TASKS_PER_HOUR` (8) caps brain-produced
  write-ups per hour; beyond it, payments STILL settle and the deliverable is honestly deferred
  ("payment real, deliverable deferred — protects the $60/mo cap"). A demand surge can never become a
  cost surge. A `showcase` ring keeps the last 8 REAL deliverables visible even though most
  settlements defer. `demandLoop()` runs every ~6–9s; the fast internal trade pulse (every ~2s) is
  untouched.
- **Dashboard:** economy.html gained a "Demand & supply — real needs, real work" section: an Open-needs
  board + a Delivered showcase of the real work, with a one-line honest summary of needs that settled
  beyond the hourly quota. Supply counter relabelled "service-ring genesis supply" (clients are
  faucet-funded, so total ≠ fixed).
- **Verified live:** /state shows 5 clients posting, service ring fulfilling; 7 real deliverables in
  the showcase (Radar concentration-risk note, Radar credit-spread basis, Kośa Nyāya summary, Chitra
  canvas-framing note, Upaya topic-fixation alert, Upaya question-repetition audit, Desk crowded-long
  alert) — all on-topic, plain-prose; brainTasks 7–8/8, deferred count climbing after, spent **$0.01**.
  Browser (Edge): dashboard renders the board, real deliverables front-and-centre, zero console errors.

**Guardrail honoured:** NO autonomous external posting (LinkedIn/X/email). Demand is real (portfolio
needs) but self-generated inside Setu — labelled as such, never dressed as organic external demand.
Population count and task volume are the real numbers from /state; "millions of agents" stays aspiration.

**Cycle 3 execution — chair (Ajay) ranked the queue 2026-07-27; order: C(smoke test) → B(persistence)
→ A(external demand) → E(liveness polish) → D(growth surface). Progress:**
- **[DONE] #1 (C) economy smoke test** — commit 3b12dae. Hermetic (`SETU_ECONOMY_TEST=1` skips
  boot/listen; module exports `server`); asserts /health, /state shape, /commission 400/402, /bogus
  404, and that a malformed request can't crash the process. `npm test` 22→23 green.
- **[DONE] #2 (B) durable economy state on a Fly volume** — commit 5c0e997. snapshot/saveState (atomic
  temp+rename, 15s) + loadState on boot; persists agents (SetuWallet.export/load), balances, counters,
  tasks/showcase, AND the spentUsd budget ledger; monthTick() makes the $/mo cap truly monthly.
  fly.toml mounts /data (volume setu_economy_data, single machine). Verified live: machine restart →
  "restored 6 agents + 5 clients (tx 37, spent $0.01)", tx continued 37→48, no genesis reset.
- **[DONE] #3 (A) genuinely EXTERNAL demand — Chitra wired (owner chose Chitra).**
  - Setu: `POST /demand` (token-auth via `SETU_DEMAND_TOKEN`, a Fly secret) ingests a real need into
    the same queue, tagged `source:'external'`. `fulfilOne` now serves EXTERNAL demand first
    (oldest-first) and gives it brain PRIORITY — it bypasses the hourly filler quota (still bounded by
    the $/mo cap), since it is deliberate token-gated real demand, so a genuine need is never starved
    by internal filler. Dashboard badges external deliverables "external · real app". Smoke test adds
    /demand→401 without token. (23/23.)
  - Chitra (C:\Users\raina\chitra, not a git repo — local only): `scripts/emit-setu-demand.mjs` posts a
    need to Setu; `.claude/workflows/council-cycle.js` chair now outputs `setuDemand {need,want,price}`
    each cycle (a real outsourceable Chitra need) for the bridge to emit.
  - **Verified end-to-end:** the Chitra chair named a real need (giclée/canvas print colour-shift
    caveats vs sRGB preview); emitted it; it landed on Setu's board as external; Scribe produced a real
    on-topic deliverable, paid on the live network. Bad token → 401. First cut had external needs
    starved/deferred by internal filler + quota — fixed with the priority rule above.
- **[DONE] #4 (E) liveness polish** — first-paint skeletons on economy.html (demand board, feeds,
  residents) and on the index.html wallet marketplace, so a cold load never shows a dead
  "connecting…"; loadMarket now retries with backoff (2s/4s, 3 attempts) + an in-place retry button.
  Verified (Edit): 14 skeletons at first paint → 0 after load; marketplace loads 7 agents; no console
  errors. Deliberately did NOT lower COG_INTERVAL_MS — the thoughts feed is already lively from demand
  deliveries every ~7s, so spending brain budget on faster low-value cognition wasn't worth it.
- **#5 (D) growth — REFRAMED by the owner 2026-07-27 to "Setu as a sandbox," NOT an outbound poster.**
  The owner asked "why not a bot?" The line held is narrow: no unattended posting to real third-party
  platforms (LinkedIn/X/email) — ToS/spam/impersonation/irreversible. But bots drumming up & solving
  demand INSIDE Setu is exactly the product; the growth engine is Setu BEING the arena agents come
  into, not an outbound spammer. Chosen direction: a bring-your-own-agent sandbox arena — a hosted
  "join" page + open (token-gated) /demand + /commission + MCP/x402 so external developers' agents
  participate for real; the network grows organically. Real-platform outreach, if ever, only via the
  owner's OWN account + official API + rate-limit + approved content policy (offered, not recommended).
  Pending owner go to build the arena.

---

## Cycle 2 — 2026-07-27 — Chair: Ajay — Grade: B+ / improving — the "stop lying, then stop crashing" cycle: live crash fixed + every overclaim killed (demand/supply theme deferred on purpose)

Objective (one line): the best HONEST consensusless settlement rail for the agent economy —
plain-spoken, feels live, feels like a usable sandbox, protocol integrity never weakened.

**Conflict resolution up front:** the owner set the Cycle-2 theme as "build genuine demand & supply".
I DEFERRED that theme this cycle and spent the budget on foundation + honesty instead. Honest reason
(hard rules (1) honesty and (2) actually-working OUTRANK the theme): the resident economy was
crash-looping — a single `/health` hit threw `ReferenceError: ticks` and killed the whole process,
resetting the market to genesis every ~30s. You cannot build a self-growing demand/supply market on a
process that keeps resetting, and five of eight seats independently converged on that crash as
CRITICAL. So this was a stabilise-and-de-overclaim cycle. The demand/supply mechanism is the #1 item
for Cycle 3, now on a foundation that stays up.

**EXECUTED (5) — all verified live:**
1. **[EXECUTED, DEPLOYED, VERIFIED] Economy /health crash fix → setu-economy.** The code fix
   (declare `let ticks=0` :51, `ticks+=1` :196, whole request handler wrapped in try/catch :266–289)
   was already in-repo from Moss but undeployed. I ran `flyctl deploy --config deploy/economy/fly.toml
   --remote-only` and verified: `/health` now 200 (was 502), survives 3+ repeated hits without
   dying, `booted:true`, brain `active/armed:true`, transactions accumulating (36 and climbing).
   Resolves Tara#1, Moss#1, Bean Counter#1, Credit-LOW, and everything downstream (Tara#3/#4/#5,
   Sutradhar#1/#3). **Deliberately did NOT bump memory 256→512mb** (Tara/Bean Counter proposal):
   the proven root cause is the ReferenceError, not OOM (Moss + Bean Counter's own evidence), so a
   2× VM cost for an unproven OOM theory fails cost discipline — resolved Tara-vs-Moss/BeanCounter
   conflict in favour of the proven diagnosis. Keep 256mb; revisit only if OOM is actually observed.
2. **[EXECUTED, DEPLOYED] economy.html honesty + resilience pass** (setu-mocha). Killed the
   three-way brain contradiction: badge now reads "brain armed ({model}) — deciding on a slow
   cadence" until a <10-min-old thought exists, only then "thinking with {model}"; empty feed shows
   an armed-waiting message, never "brain is off" while armed. Fixed the permanent false-"live"
   first impression (poll() catch now sets "network unreachable — retrying…" and dims the live-dot
   instead of leaving "connecting…" forever). Relabelled counter "all-time"→"this run"; "Six AI
   agents"→"a live population"; rewrote the stale footer ("AI brain is the next step") to match the
   shipped armed brain. Resolves Tara#2, Sweetie (H+L), Shareholder#2, Sutradhar#1, Credit-drift.
3. **[EXECUTED, DEPLOYED] pitch.html MCP overclaim fix** (Shareholder#1). "any agent can already
   reach it through the two protocols agents speak — MCP and a live x402 endpoint" → "any agent can
   pay a live x402 endpoint today, or run the Setu MCP server locally to give itself a wallet."
   setu-mcp.fly.dev is unrouted (HTTP 000); the old copy claimed a hosted MCP endpoint that does not
   exist — a direct hit on "public claims must match tested capabilities."
4. **[EXECUTED, DEPLOYED] Honest-register refresh** (Credit's A- unlock). capabilities.json:
   generated 2026-07-24→2026-07-27; economy limitation "ephemeral /tmp"→"durable Fly volume
   (SETU_STATE_DIR=/data)" (was contradicting the durable-persistence entry); economy deployment
   "brain off until a key is set"→"AI brain armed (claude-haiku-4-5, $60/mo hard cap + per-IP 15 /
   global 300 daily limits)" + in-memory-reset caveat; test suite "12 tests"→"22 tests (12 protocol
   + 5 e2e + 5 persistence)" (verified `npm test` → 22/22). STATUS.md: 12→22, plus a disclosed
   live-paid-LLM cost/abuse-envelope paragraph (cap, limits, spend visible at /state, payments
   settle when budget spent, in-memory caveat).
5. **[EXECUTED, DEPLOYED] CFO number honesty** across index.html + pitch.html + whitepaper.html.
   "423 /s" → "~340–420 /s … (Node 24; run npm run bench)" (fresh runs reproduce ~335–352, not 423);
   "~200 ms" → "~280 ms typical … (216 ms to re-spend received funds; higher when a region is cold)"
   (warm WAN p50 ~283 ms); the "averaging 186 ms" live-network paragraph → "each finalising in a few
   hundred milliseconds" (186 was stale/uncomputed/unreproducible). Kept the qualitative story
   (10 paid, 11th budget-blocked, forged cert rejected, sentinel consistent — all still backed).

**DEFERRED (Cycle 3 queue, ordered):**
- **#1 Economy state + budget/rate-counter persistence to a Fly volume** (Moss#3, Tara, BeanCounter#2,
  Credit). Reuse authority.ts atomic temp+rename; mount /data on setu-economy. Makes the $60/mo cap a
  durable monthly ledger (today it's per-process-lifetime; acceptable one cycle now that the crash
  loop is gone and restarts are deploy-only) and makes counters genuinely cumulative so the "this run"
  relabel can revert to "all-time."
- **The Cycle-2 demand/supply mechanism itself** (owner theme; Shareholder#3, Moss/CFO). Smallest
  honest version: route a fraction of internal ticks through the real /commission deliverable path
  (seller produces actual work), reusing the $60 cap + a new internal per-hour brain quota so it
  degrades to label-only settlements when budget is the bottleneck — never silent overspend. And/or
  ground demand in the owner's own app-councils (real paid Sutradhar walkthroughs / analyses). This
  is now the headline item.
- economy smoke test (Moss#2) — start on port 0, assert /health & /state shape, /bogus=404, process
  survives a malformed request; wire into `npm test` so a crashing endpoint can never ship green again.
- COG_INTERVAL_MS lower (240s→~90–120s) so a visitor actually sees a thought — pair with persistence
  (speeding cognition without durable spend risks faster budget burn).
- index.html loadMarket retry/backoff + in-place retry button (Sutradhar#2, BeanCounter#3) — downstream
  of the crash fix; economy stays warm now so rarely hit, cheap to add.
- Sweetie's legible-market reframe (dedupe repeated "set price" thoughts, lead with the trade feed as
  the demand signal) — pair with the demand/supply work.
- Carried: §18/§24 partition/clock-skew integration test + THREAT_MODEL.md; first-paint skeleton;
  primer 2-minute version; deliverable markdown polish; pre-charge daily-limit pre-check.

**DROP:**
- economy.html "connecting them to an AI brain … is the next step" footer — replaced (it under-claimed
  a shipped, live capability).
- Memory 256→512mb bump as a crash fix — dropped; the ReferenceError was the real cause. 256mb stands.

**ESCALATE:** none. The ANTHROPIC_API_KEY is already a Fly secret; no spend beyond caps; no
protocol-shape change; no new credentials.

**NOT converged** — the owner's demand/supply theme is not yet delivered, and persistence + economy
tests are material open items.

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

**SANDBOX DEPTH — SECOND HALF SHIPPED 2026-07-26 (owner supplied the key):** the economy AI brain
is now ARMED (ANTHROPIC_API_KEY set as a Fly secret on setu-economy; brain.active=true, model
claude-haiku-4-5, $60/mo hard cap). A hired agent now actually DOES THE WORK and returns it:
- `economy.ts` `POST /commission` verifies the settlement certificate cryptographically
  (`verifyCertificate` from setu-pay: sender signature + quorum of authority signatures), confirms
  it paid THIS agent ≥ its price, guards replay (keyed sender:seq → idempotent, no double-charge),
  then the agent's persona produces the deliverable (plain prose, ≤180 words, budget-gated).
- `index.html`: after settlement the wallet POSTs the certificate to /commission and renders the
  deliverable (task input added; XSS-escaped). Honest framing kept: if the shared budget is spent
  the visitor still gets the verified receipt, no fake output.
- **Verified end-to-end:** server-side — pay Scribe → real risk note; replay → cached (no
  double-charge); tampered amount & tampered recipient → 402 "bad sender signature" (forgery gate
  holds); genuine Oracle/Analyst → real deliverables. Browser (Edge/Playwright) — create → faucet →
  type task → hire Scribe → FINAL 803 ms, settled 4/4, deliverable rendered "produced by
  claude-haiku-4-5", zero console errors. This is the honest design: real payment cryptographically
  unlocks real work; nothing faked.

**ABUSE GUARD SHIPPED 2026-07-26:** the open faucet + the now-live paid brain meant one actor could
mint test Credits and burn the shared AI budget. Added daily rate limits to `/commission` in
`economy.ts`: `COMMISSIONS_PER_IP_DAY` (default 15, via fly-client-ip / x-forwarded-for) and
`COMMISSIONS_GLOBAL_DAY` (default 300), resetting on UTC date; only real (paid-for) deliverables
count; cached replays and rejects do not. Over-limit returns an honest message ("payments still
settle; deliverables resume tomorrow") and the wallet labels it "daily demo limit". The $60/mo
brainOn() cap remains the absolute backstop. **Verified live:** temporarily set the per-IP limit to
2 → calls 1–2 delivered, call 3 rate-limited; restored to 15.

**DEFERRED QUEUE (backlog for next cycles):**
- #8 first-paint skeleton for the live-network panel + explorer (cold machines show ~2–3.7s round
  trips on first paint — honestly labelled now, but a skeleton would soften the first impression).
- #9 a 2-minute-version summary at the top of primer.html.
- Deliverable polish: consider light markdown rendering (or keep plain prose — currently plain).
- Fairness nicety: a visitor over the daily limit still pays before being told — consider a cheap
  pre-check endpoint so the wallet can warn before charging (amounts are free test Credits, so low
  priority).
- Protocol §18/§24: partition/clock-skew integration tests + written THREAT_MODEL.md (Moss/Credit).

**Not converged** — the sandbox-depth and economy-liveness items are material and open.

Deploy note: front-end fixes ship to Vercel via the strict allowlist in `.vercelignore` (HTML only,
never secrets). `npm test` must stay green (22 tests) before any protocol-adjacent change.
