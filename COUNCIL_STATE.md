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

**CYCLE 6 FOCUS (2026-07-29):** The economy is now a VERIFIED WORK MARKETPLACE, app-to-app. Judge it
live: (1) apps fulfil EACH OTHER's demand (pickSupplier prefers another app over the ring; SUPPLIES
map); (2) every job is a VERIFIED JOB — genCriteria quantifies the demand into acceptance criteria, an
INDEPENDENT verifier scores each criterion 0-10, and Setu settles ONLY if accepted (rejected work shown
unpaid); (3) 8 apps flow real external demand (Chitra, Radar live-council-wired + 6 more via portable
bridge). economy.html reframed "verified jobs, app to app" with per-criterion score badges. Key
questions: Is the verifier TRUSTWORTHY (does it actually reject bad work, or rubber-stamp)? Is the
acceptance/criteria loop honest and legible, or theatre? Is app-to-app matching sensible (right supplier
for a need)? The OPEN on-ramp for outsiders to SUPPLY and VERIFY (not just demand) is unbuilt — is that
the top gap? Budget: each verified job is ~3 brain calls — is the $60/mo envelope still safe (quota now
6/hr)? Sutradhar: walk the LIVE economy.html + landing viz + arena on a real browser; confirm verified
jobs render with criteria + scores and rejected-unpaid cases show honestly. The owner wants CONTINUOUS
cycles — after this one, keep improving.

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

## SECURITY — 2026-08-02: emailed faucet report + the REAL bug it missed (commit badb488)

An emailer ("Liam Tremblay") reported `/admin/fund` is unauthenticated on the live authorities and
demanded **$5,000** before disclosing details, with a 72-hour deadline. **Assessment: the endpoint is
open, but the framing is wrong and the demand should not be paid.** It is a deliberate, self-documented
testnet faucet (`authority-server.ts:9` "devnet only, would not exist in production"; capabilities.json
lists it as "an open testnet issuance endpoint"; the landing page has a **"faucet +500" button**). Credits
are closed-loop TEST units — "mint unlimited currency" means minting valueless demo tokens. The quoted
stats came from the public `/stats` endpoint. Pattern = beg-bounty/pressure, not responsible disclosure;
there is no bounty programme. **Do not pay, do not negotiate.**

**But auditing it found a REAL integrity bug the report missed:** `fund()` never validated `amount`, so a
NEGATIVE value **drained** an account and broke value conservation. **Confirmed live** before fixing: a
500-balance account dropped to 100 via `{"amount":-400}`.
- `authority.ts fund()` now rejects non-integer/zero/negative amounts + malformed addresses and returns
  `{ok,error}` — applies to EVERY caller, so state can never be corrupted. The size cap sits at the HTTP
  layer instead, so in-process genesis (demo-issuer's 1M supply) still works.
- `authority-server.ts`: per-call cap (`SETU_FAUCET_MAX`=1000), per-address balance cap (100k), per-IP
  hourly limit (60), and it returns the error instead of a blind `{"ok":true}`.
- `test/protocol.test.ts`: regression test (negative/zero/1.5/NaN/±Infinity refused, balance untouched).
  **25/25 green.** Deployed to all 4 authorities; verified live: negative + oversized rejected, legit
  faucet works, balance holds, payments still settle 4/4.

**Cycle-6 items implemented this session (the council decided; I applied + verified):** economy.html
absolute "settles only if it passes" → honest version naming the deferred path (43 deferred/hr proved the
absolute false); stand-in disclosure restored with the VERIFIED count — **seven** apps live-council-wired
(counted in the repos, not 15 and not 1); "settled this run" → "settled to date"; a verdict with no numeric
scores renders "could not verify" instead of a false "rejected 0/100 unpaid"; economy.ts loadState drops
pre-verification showcase entries; pitch.html latency reconciled to ~180 ms warm (p50) in all three places.
**Still open from Cycle 6:** explorer.html false-offline (6s→10s) + false-green dot, index.html count
reconcile + viz salience, §18 partition test + THREAT_MODEL.md, claims-consistency guard.

**CONTINUOUS CYCLES:** the owner asked for cycles to run continuously. A recurring job now fires a full
cycle (8 seats + Sutradhar) **every 2 hours at :23**, implements the EXECUTE items, tests, deploys and
verifies. Caveat: session-only — it dies when the Claude session ends and auto-expires after 7 days.

---

## Cycle 6 — 2026-08-01 — Chair: Ajay — Grade: A- / flat — "finish the honesty reconciliation the code outran, and stop the two 'live' pages lying"

Objective (one line): the best HONEST consensusless settlement rail for the agent economy —
plain-spoken, feels live, feels like a usable sandbox, protocol integrity never weakened.

Headline: five seats independently converged on the SAME miss — the verified-jobs marketplace and the
multi-app wiring shipped fast post-Cycle-5, and three public surfaces now overclaim what the code does.
So this is a reconciliation cycle: kill the live overclaims (pitch latency contradiction, economy
"every job verified", the lost stand-in disclosure, a false-rejection rendering), make the explorer —
the page literally titled "live window" — stop reporting healthy nodes as offline, and pin the one
untested protocol surface (partition/catch-up) with a test + written threat model. No protocol-shape
change, no new spend, no keys. Verified the exact cited lines live before deciding (pitch.html:66/77/83/104,
economy.html:66/74/76-80, explorer.html:116/145, index.html:81-82/123/177).

**EXECUTE (5):**
1. **Public-surface number honesty sweep — pitch.html + whitepaper.html** (Shareholder HIGH+MED, CFO
   HIGH+MED, Credit LOW, Sutradhar MED — 5-seat convergence). Cycle 5 claimed it unified the finality
   figure but only touched index+whitepaper and MISSED pitch, which now self-contradicts on the headline
   metric in the first 60s of the partner brief. (a) pitch.html:66 "about 200 milliseconds across
   continents" → "about 180 milliseconds warm across four regions (p50; higher when a region is cold)";
   (b) pitch.html:77 stat tile "~280 ms" / "typical payment finality across four regions" → "~180 ms" /
   "warm payment finality, four regions (p50; higher when cold)"; (c) pitch.html:83 align "a few hundred
   milliseconds" to the same figure; (d) pitch.html:104 replace the falsifiable superlative "(the piece
   nobody else has)" — AP2/session-keys are prior art — with the true edge "(enforced in the settlement
   layer itself — no chain, no smart-contract VM, checked in one round trip)"; (e) pitch.html:91 cut the
   hype sentence "That is the market telling you this is real." (keep the factual Mastercard/Visa/Coinbase/
   Google list — it makes the point unaided); (f) whitepaper.html:232 relabel the "280/280 chained spends
   first-try" tile that sits beside "~180 ms warm … four regions" — it is the LAPTOP bench reading as a WAN
   result; make the four-region figure the honest live "48/48 live" and tag the 280/280 as "on a laptop".

2. **economy.html + economy.ts honesty bundle** (Sweetie HIGH×2 + LOW, Credit HIGH). The flagship page
   over-claims and mislabels honest work. (a) economy.html:76-80 replace the absolute "Every job is a
   verified job … the payment settles on the network only if it passes" with the honest, still-strong
   version that names the deferred path: verified on a pass, rejected work shown unpaid, AND "when the
   hour's shared AI budget is spent, payments still settle and the write-up is deferred — a demand surge
   never becomes a cost surge" (124 unverified deferred settlements/hr live proves the absolute claim
   false); (b) economy.html:74 RESTORE the Cycle-4 stand-in disclosure the Cycle-6 reframe overwrote
   (Credit's HIGH regression) — after "The builder's 15 apps post genuine needs" add the true caveat that
   ~eight are wired to live councils and the rest replay each app's needs bank until its bridge is added
   (VERIFY the exact currently-emitting count against live /state before writing — football-league's schema
   was "left for a manual pass", so if fewer than 8 emit, state the true number); (c) economy.html vbadge
   :195-200 — when a verdict has an empty/absent numeric scores[] OR a reason indicating the verifier could
   not score, render a neutral "could not verify" badge, NEVER "✗ rejected 0/100 · unpaid" (live id 10224
   maligns Scribe's real CRE note as a false rejection); (d) economy.ts loadState :433 — drop persisted
   showcase entries whose verdict predates the current shape (no numeric scores[] array) so the "verified
   jobs" section only holds current-mechanism jobs (self-refills within ~an hour); (e) economy.html:66
   counter label "payments settled this run" → "payments settled to date" (persistence made it cumulative).

3. **index.html landing — honesty reconcile + make the marquee actually feel live** (Credit MED,
   Shareholder LOW, Sweetie LOW; Sutradhar MED). (a) index.html:81-82 AND :177 change "Chitra is wired
   live… the rest replay" (says only 1 wired — under-claims the shipped system, and directly contradicts
   economy.html's "15") to the reconciled true count — "eight of the builder's apps are wired to their live
   councils; the rest replay each app's genuine needs bank" (VERIFY the count against COUNCIL_STATE + live
   /state, same number as item 2b); (b) index.html:123 SVG header "YOUR APPS — DEMAND" → "THE BUILDER'S
   APPS — DEMAND" (a newcomer has no apps on the left; contradicts the honest prose beneath it); (c)
   feels-live viz (owner's #1 recurring question): in poll()/build (~:166,:178-184) pre-seed `seen` with the
   initial trade backlog on first build (or cap the opening replay to the last ~8) so the marquee stops
   opening with a 10s ~60-dot flood that then goes nearly dead; in pulse() (:149-158) raise real-dot
   salience (r 5→7, opacity 0.35→0.6, dur 1100→1600ms, brief fading trail) so the genuine ~8/min flow
   always shows motion. HARD CONSTRAINT: never animate a payment that did not happen — no rate inflation.

4. **Turn the §18 partition/catch-up surface from untested into TESTED + documented** (Moss MED — his
   THE-one-change; priority (1) protocol integrity). Largest untested protocol surface, now live-observable
   (authorities diverge: auth-1 ~59k settled vs others ~68k). test/protocol.test.ts: 4 authorities, run
   several settlements for one sender delivering the cert to only 3 (skip auth-4); assert auth-4 rejects a
   later cert with "sequence gap (authority behind)"; assert NO double-spend is reachable against the
   lagging auth-4 (the healthy 3 hold the first-seen lock); replay the missed certs to auth-4 IN ORDER and
   assert it heals and all four balances match. Write THREAT_MODEL.md (§24): single-operator trust,
   client-driven settlement with no authority-to-authority anti-entropy, the sequence-gap stall +
   ordered-replay heal, clock-skew on expiry, and the no-lock-cancellation liveness gap. Keep npm test green
   (24→25). No protocol change, no deploy — pure integrity gain.

5. **explorer.html — stop the "live window" page reporting healthy nodes as offline + false-green dot**
   (Tara HIGH+MED, Bean Counter HIGH — convergence). (a) explorer.html:116 AND :145 raise
   AbortSignal.timeout(6000) → 10000 to match index.html:305 — a measured 6.71s cold auth-1 this session
   crosses the 6s cap and flips to a FALSE "offline"/"—" and under-reports the online counter (e.g. 3/4),
   implying a sub-quorum network when it is just booting; the 2.5s poll still resolves a truly-dead node
   fast. (b) freshness-gate the headline dot: give the header dot (:26/:61) an id, and in poll()/tickAgo()
   reuse the already-computed server-now (:182) to derive age = now − newest tx.at; set the label from
   up-count + age (up<3 → muted "◐ waking / degraded"; else age<15s → "● live"; 15–120s → amber "● quiet";
   >120s → muted "● no new payments") — replacing the hardcoded always-green "A live window on the network"
   that today renders green over a 0/4 outage. Reuses the exact index.html/economy.html:170-175 pattern
   (Cycle 4 fixed those two and missed explorer). Closes both the false-offline and false-live signals + the
   feed-stall gap on the one page whose whole job is truthful live state.

**Conflicts resolved:** Tara and Bean Counter proposed the identical explorer 6000→10000 timeout — merged
into item 5. Shareholder/CFO/Credit/Sutradhar all flagged the pitch latency contradiction — merged into
item 1. Sweetie (verified-jobs overclaim) and Credit (lost stand-in disclosure) both target economy.html
honesty — complementary, both in item 2. App-wired count disagreement (index says 1, economy says 15,
reality ~8): resolved by reconciling BOTH pages to one VERIFIED honest number (items 2b + 3a), with an
explicit instruction to check live /state and downgrade if football-league's un-schema'd bridge means
fewer than 8 currently emit — never assert a wiring the code can't back.

**DEFER (Cycle 7 queue, ordered):**
- **Claims-consistency guard** (CFO): scripts/check-claims.mjs (or test/claims.test.ts) greps
  index/pitch/whitepaper for the canonical latency/throughput/quorum tokens and asserts a single numeric
  value per metric across pages; wire into npm test. This EXACT miss (pitch left at 280ms) is what Cycle 5
  did; the guard permanently closes the recurring finding class. Top of the queue — prevention, not a live
  fix, so it yielded a slot to the five live fixes this cycle.
- **Widen the two 2.5s poll loops to ~4.5s + raise index.html loadMarket timeout 9000→12000** (Bean
  Counter): a single /state takes 2–8s on shared-cpu-1x, so 2.5s polling launches overlapping in-flight
  requests onto the same starved CPU; ~4.5s roughly halves pressure and still feels live. loadMarket's 9s
  is <1s of margin over a measured 8.2s /state → can show a false "couldn't load the market".
- **Move the per-settlement copyFileSync whole-file .bak off the hot path** (Bean Counter): keep the
  crash-safe atomic temp+rename on every settle, move .bak regeneration to a periodic/boot timer (keep a
  .bak; keep test/persistence.test.ts green). Deferred, not dropped — the idle gateway proves persist isn't
  today's dominant latency factor, and it needs npm-test-green + a setu-economy deploy. NOT an escalation
  (perf change, wire format + safety unchanged), but it touches tested persistence so it wants a careful
  pass, not a rushed one.
- **Bounded clock-skew tolerance on delegation-expiry** (Moss LOW): EXPIRY_SKEW_MS=5000 at authority.ts:284
  + a test that authorities within SKEW agree at the boundary (no quorum split). Loosening only the expiry
  lower-bound by a small bounded amount cannot mint value or bypass caps. Needs a deploy; the §18 test
  (item 4) may inform it.
- **Honest retries must not burn rate-limit tokens** (Moss LOW): short-circuit the exact idempotent-retry
  re-sign BEFORE bucket.tryConsume() (authority.ts:239-256) so a client re-presenting its own valid pending
  order to reach quorum under a partition isn't throttled into a stall. Needs a deploy.
- **/stats settled/volume are per-process, not network totals** (Moss LOW, Sutradhar LOW): they reset on
  restart (persist() serialises only accounts+delegations), so the explorer committee tiles read as a
  "lagging node" when auth-1 was merely restarted — this is display-honesty, NOT balance drift. Either
  persist the counters or relabel the tiles per-authority-since-restart.
- **economy "Credits in circulation" (360) understates faucet-minted balances** (Sutradhar LOW): relabel to
  "service-ring genesis supply" OR compute true circulating (sum of all agent+client balances) in
  economy.ts /state and bind c-supply to that.
- Still open from Cycle 5: the OPEN on-ramp for OUTSIDERS to SUPPLY and VERIFY; human-verifier option;
  per-criterion scoring in the verdict (v1 holistic); football-league council schema.

**DROP:**
- pitch.html §04 "That is the market telling you this is real." — cut as hype (executed inside item 1e);
  the factual incumbents list validates the CATEGORY, not Setu, and makes the point without editorial.

**ESCALATE:** none. No item spends beyond caps, needs credentials/keys, or changes protocol shape; none
needs the owner's ANTHROPIC_API_KEY (already a Fly secret). Item 4 is test+doc only. Items 1/3/5 are HTML
(Vercel via the .vercelignore allowlist); item 2 also touches economy.ts loadState (a normal setu-economy
deploy, no protocol change).

**Deploy note:** items 1/3/5 + economy.html ship to Vercel; item 2's economy.ts loadState filter needs a
`flyctl deploy` of setu-economy after `npm test`; item 4 is repo test + doc (no deploy) and must keep
`npm test` green (25). If flyctl auth fails, use FLY_API_TOKEN=$(cat scratchpad/fly_token) per the Cycle-5
ops note.

**NOT CONVERGED** — three live HIGH overclaims (pitch latency contradiction, economy "every job verified",
the regressed stand-in disclosure), a live false-rejection rendering, a false-offline/false-green explorer,
and the largest untested protocol surface all remained at cycle start. That is not a cosmetic-polish-only
state; material honesty + working-experience + integrity items are shipping and more sit in the queue.

---

## Cycle 5 — 2026-07-28 — executed the top of the Cycle-5 queue (owner ran it)

Four items shipped + verified live (economy + 4 authorities + Vercel; npm test 24/24):
1. **[DONE] Reserve a live-human slice of the hourly brain quota** (Sweetie HIGH — was the #1 item).
   economy.ts: `INTERNAL_BRAIN_PER_HOUR=6` caps internal (stand-in) deliverables so ≥2 of the 8 hourly
   slots are always available to a real guest/arena human; `brainQuotaOk(source)` enforces it, guest
   demand can use any of the 8. /state exposes `internalPerHour`/`humanReserved: 2`. The marquee "drop a
   need → watch it solved" no longer loses to synthetic filler at 8/8.
2. **[DONE] Cap the cognition loop** (Bean Counter MED). `COG_PER_HOUR=8` + `cogThisHour` gate on
   cognitionLoop — every brain path now has a provable per-hour bound under the $60/mo backstop. New
   hour-counters persisted (snapshot/loadState).
3. **[DONE] Skew-correct explorer "Xs ago"** (Tara MED). authority.ts stats() now returns `now`
   (server clock); explorer.html captures serverNow+clientAtPoll and reconstructs server time, so a
   skewed device clock no longer reads the feed as falsely fresh/stale. Deployed to all 4 authorities.
4. **[DONE] Reconcile the two WAN latency figures** (CFO LOW). Landing "~280 ms" and whitepaper
   "~183 ms/hop" unified to "~180 ms warm (p50; higher when cold)" on both — matches a live 179 ms
   payment and the chained-spend benchmark.

**[DONE post-cycle] Wire a second app's live council** — Counterparty Intel ("Radar") is now the 2nd
real-council-wired app (after Chitra). Added a PORTABLE bridge (`scripts/emit-setu-demand.mjs`,
`SETU_APP=Radar`) + `setuDemand` to its council chair; the chair named a real need (AI data-center
supply-chain contagion), emitted → Setu /demand → a Setu agent delivered a real risk note. Pushed to
counterparty-intel. Same bridge drops into any app (set SETU_APP). **Wiring it surfaced + fixed 3 real
bugs** (Setu 2a54a02): (a) persistence survived only ONE restart — `SetuWallet.load()` made restored
keys non-extractable so re-save threw "key is not extractable" → silent genesis fallback; fixed to
extractable + round-trip test; (b) fulfilOne head-of-line-blocked on any unpayable/failed task (froze
the whole demand loop) → now skips + retires after 5 tries; (c) a client with a stale pending lock (no
protocol lock-cancellation yet — Moss's deferred gap) could never settle → self-heal rotates its wallet
after 3 failed pays. Showcase now retains external/guest deliverables over internal filler.

**[DONE post-cycle] Wired 6 MORE apps' live councils (8 total now).** Dropped the portable bridge
(`scripts/emit-setu-demand.mjs`, per-app `SETU_APP`) into crypto-tracker (Desk), reg-data-os (DataRoom),
jnana-kosha (Kosha), aaronson-academy (Ansatz), vedic-astro-app (Jyotish), football-league (Pitch); and
programmatically added `setuDemand` to the 5 councils that share the AJAY_SCHEMA template (all node
--check clean). football-league's council uses a different template — bridge in place, schema left for a
manual pass. Committed to the git repos (reg-data-os, vedic-astro-app pushed; counterparty-intel earlier);
the local-only apps (crypto-tracker, jnana-kosha, aaronson-academy, football-league) have the changes on
disk (they deploy from local via Vercel). **Demonstrated breadth live:** emitted a genuine, self-contained
need for all 6 → all delivered real on-topic work (Desk morning signals, DataRoom control-scan, Kosha
Nyaya entry, Ansatz P-vs-NP ladder, Jyotish weekly guidance, Pitch team split). With Chitra + Radar, **8
apps now flow real external demand** through Setu, badged "external · real app". The self-heal + robust
fulfilOne handled any stuck clients transparently.

**[DONE post-cycle] VERIFIED JOBS, APP-TO-APP (owner's core ask — the real mechanism).** commit 3545abb.
The economy went from apps→ring to a real work marketplace: apps fulfil EACH OTHER'S demand, and every
job is acceptance-verified before payment. Lifecycle in economy.ts fulfilOne: (1) genCriteria turns a
need into 3 checkable acceptance criteria; (2) pickSupplier prefers ANOTHER app whose SUPPLIES
capability matches, over the ring; (3) the supplier produces in-persona; (4) an INDEPENDENT verifier
scores it vs the criteria (robust JSON+text fallback+retry) → accept/reject + score + reason; (5) the
requester pays the supplier on Setu ONLY if accepted — rejected work is shown, unpaid. App suppliers
earn (sold/earned); /state exposes supplies+criteria+verdict; economy.html reframed "verified jobs, app
to app" with verified/rejected badges + criteria + verifier reason. Quota 8→6 (each job ~3 brain calls).
**Verified live:** Radar (Counterparty Intel) → DataRoom (Data Control Room) — app-to-app — verifier
72/100 accepted, settled; a weaker one rejected+unpaid.

**Still open:** the OPEN on-ramp for OUTSIDERS to SUPPLY and VERIFY (posting demand already works via
guest/arena, now verified too); human-verifier option; micro-cache /state; delegation-expiry skew +
§18 test + THREAT_MODEL.md (lock-cancellation gap); football-league council schema; per-criterion
scoring in the verdict (v1 is holistic). Verified live: /state humanReserved 2, /stats `now`, payment 4/4.

**OPS NOTE (2026-07-29):** flyctl's stored token stopped being picked up mid-session ("no access token
available"); the token in `~/.fly/config.yml` is still valid — recovered by passing it as
`FLY_API_TOKEN=$(...)` per deploy (stashed in scratchpad/fly_token). If deploys fail on auth, re-run
`flyctl auth login` interactively.

---

## Cycle 4 — 2026-07-28 — Chair: Ajay — Grade: B+ / improving — "kill the double-spend, then stop overclaiming the front door"

Objective (one line): the best HONEST consensusless settlement rail for the agent economy —
plain-spoken, feels live, feels like a usable sandbox, protocol integrity never weakened.

Headline: Moss found a REAL protocol break (value could be minted) — that outranks everything, so it
led. Then three seats (Shareholder CRITICAL, Credit, CFO, Sutradhar, Sweetie) converged on the same
two live overclaims — the landing implying 15 real apps are wired when only Chitra is, and a "4 ms"
finality number nothing reproduces. Fixed both. All five EXECUTE items are IMPLEMENTED this cycle
(not just decided); protocol fix verified green, HTML/register edits pending the owner's deploy.

**EXECUTED (5):**
1. **[DONE, VERIFIED] Cross-track double-spend fix — protocol integrity (Moss CRITICAL).** A principal's
   balance is one pool but the first-seen lock was per-track: a direct spend (account.pending) and a
   delegated spend (delegation.pending) on the same balance each passed an independent balance check
   and both settled → principal to NEGATIVE = value minted. This bit HONEST concurrent use (principal
   spending while its own agent spends). Fix in `src/authority.ts`: new `private reservedAgainst(owner)`
   sums the owner's own pending + every delegation with `principal===owner && pending`; both balance
   guards (direct ~:242, delegated ~:278) now subtract it. Reservation auto-releases when pending clears
   at settle; pending is already persisted so it survives restart. Cross-authority safe: under a real
   race, differing first-seen order means at most one spend reaches quorum (correct FastPay safety), the
   loser stalls. Added regression test to `test/protocol.test.ts` (direct+delegated concurrent 100-draw
   on a 100 balance: asserts not-both-settle, supply conserved, balance never negative). `npm test`
   23→24 green. This restores the headline "double-spend-proof / value conservation" invariant that was
   live-reachable-false.
2. **[DONE] Retire the unbacked "4 ms" finality number (CFO HIGH).** `npm run demo` reproduces ~31.7 ms
   in-process, not 4 ms (~8x overclaim) — no sub-10ms measurement exists in src/. Replaced all four
   public surfaces — index.html:285, :560, :601 (roadmap), whitepaper.html:230 — with "~30 ms in-process,
   four authorities on one machine (npm run demo)". Kills the last member of the stale-number family
   Cycle 2 cleaned up.
3. **[DONE] Kill the "your apps" landing overclaim (Shareholder CRITICAL; Credit/Sutradhar/Sweetie).**
   14 of 15 landing nodes are stand-in personas replaying a needs bank; only Chitra is live-council-wired.
   Reworded index.html:81 header + :169 viz-note to say plainly "the builder's apps post real needs —
   Chitra is wired live to its council; the rest replay each app's genuine needs bank." Same disclosure
   ported to economy.html:74 (and updated "5 apps"→"15 apps"). This is the exact Cycle-4 honesty question.
4. **[DONE] Freshness-gate the "live" signal + never-permanent-"connecting" (Tara HIGH + LOW; Tara MED on
   economy.html).** index.html viz-HUD and economy.html live-dot both hardcoded green on any successful
   /state fetch — a stalled-but-reachable economy (Cycle-2 crash class) read as "live". Now both derive
   the indicator from `age = now - lastTradeAt`: <15s green "● live", 15–90s amber "● quiet", >90s muted
   "● waking up". index.html poll() partial-state bail now writes a "waking up — retrying…" note instead
   of leaving "connecting…" stuck forever.
5. **[DONE] Register re-sync + usable-sandbox/plain-words sweep (Credit MED/LOW, CFO MED, Sutradhar MED,
   Sweetie MED/LOW).** capabilities.json + STATUS.md: "22 tests"→"24" with correct breakdown; deleted the
   stale "economy state in-memory, reset on restart / per-process-lifetime cap / durable persistence is
   queued" — replaced with the shipped truth (durable Fly volume + monthTick() true monthly ledger,
   Cycle 3). index.html hire(): the paid deliverable now `scrollIntoView`s and the log says "report below
   ↓" (it rendered 211px below the pay button, unseen — undercut "pay → agent produces your deliverable").
   economy.html: dropped the jargon "service-ring genesis supply"→"Credits in circulation", "GDP"→"Credits
   moved". explorer.html footer "every 4 seconds"→"every 2.5 seconds" (matched the code). arena.html:
   de-hyped "autonomous agent that lives in the economy / acts on its own" → "a bot you start from this
   tab; while it's open it posts a need every ~22s and pays a real agent" (Shareholder MED — it's a
   browser setTimeout loop, not a resident autonomous agent).

**Conflicts resolved:** all seats that touched the landing wanted the same "your apps" disclosure — merged
into one reword (item 3). CFO wanted "4 ms" retired OR a real microbench; chose retire+reproducible-figure
(no microbench producing 4 ms exists — inventing one to save the number would be the dishonest path).
Sweetie's quota-reservation (item below) vs the scrollIntoView both target the marquee payoff — did the
cheap high-certainty scrollIntoView now, DEFERRED the economy.ts quota split.

**DEFERRED (Cycle 5 queue, ordered):**
- **Reserve a live-human slice of the hourly brain quota** (Sweetie HIGH): cap internal filler at
  INTERNAL_QUOTA=6 so ≥2 of 8 slots only a real guest/arena human can consume; total stays ≤8/hr (cap
  untouched). Real system win — the marquee "drop a need → watch it solved" currently loses to synthetic
  filler at 8/8. economy.ts fulfilOne() ~:239. Not done this cycle only because it's a behavioural
  economy change wanting care; it is the top Cycle-5 item.
- **Cap the cognition loop under the hourly ceiling** (Bean Counter MED): cognitionLoop (economy.ts ~:385)
  is the only brain path with no per-hour bound — add `brainQuotaOk()`/COG_PER_HOUR so the $60 cap is
  provably comprehensive across ALL brain paths.
- **Skew-correct explorer "Xs ago"** (Tara MED): add `now` to /stats (or /recent) and mirror economy.html's
  ageOf so a skewed visitor clock stops reading the feed as falsely fresh/stale.
- **Micro-cache /state ~1000ms** (Bean Counter LOW): memoize the 20.8KB serialization within a 1s window;
  smooths the 0.78→1.74s latency spikes under many concurrent tabs. Low now at $0.01 spend / single viewer.
- **Delegation-expiry clock-skew tolerance + §18 partition/clock-skew integration test + THREAT_MODEL.md**
  (Moss LOW×2, carried): SKEW_MS tolerance at authority.ts:267; no-lock-cancellation liveness gap
  documented in the threat model.
- **Wire a second app's council (Chitra-pattern bridge)** (Shareholder/owner theme): shrinks the 1/15
  live-wired gap; the honest long game vs growing the stand-in illusion.
- Reconcile the two live-WAN latency figures (~280ms landing vs ~183ms whitepaper) to one dated, defined
  number (CFO LOW).

**DROP:**
- Switching setu-gateway to auto_stop (Bean Counter's own drop): the ~$2/mo saving isn't worth a cold
  first-hit on the publicly-claimed "live x402 endpoint today". Keep it warm.
- Uniform gold treatment of all 15 landing nodes as identical: superseded by item 3's disclosure (kept the
  viz, added the honest wording) rather than a hard visual split this cycle.

**ESCALATE:** none. No spend beyond caps, no credentials/keys, no protocol-shape change (the reservation
fix TIGHTENS an existing balance check — same wire format, backward-compatible, safety-restoring — so it is
within the seat's integrity mandate, not an escalation). The ANTHROPIC_API_KEY is already a Fly secret.

**Deploy note:** item 1 needs a `flyctl deploy` of setu-economy (authority.ts) after `npm test` (24 green);
items 2–5 HTML/register ship to Vercel via the strict .vercelignore allowlist; capabilities.json/STATUS.md
are repo docs. Owner's loop to deploy.

**NOT converged** — a CRITICAL protocol break existed this cycle and two live overclaims were on public
pages; that is not a cosmetic-polish-only state. Material items remain in the deferred queue (quota
reservation, cognition cap, second app bridge).

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
- **[DONE] Landing visualization + one-click guest onboarding (owner ask 2026-07-27).**
  - `index.html`: a live network viz is now the FIRST thing on the page — apps (demand, left) ↔ agents
    (supply, right), built dynamically from /state, animated dots for every real payment (gold=app
    commissioning, green=newcomer, faint=internal), live HUD (payments/min, GDP). Answers "I want to
    see it going / apps talking."
  - Onboarding simplified: MCP/x402 copy-config collapsed into a "For developers" details; page leads
    with the one-click in-page wallet. NEW open guest flow: type a need → one click → it drops into the
    live economy (green newcomer pulse) → an agent solves it → deliverable shown. No wallet/keys/copy.
  - Backend: OPEN `POST /guest-demand` (rate-limited GUEST_PER_IP_DAY=3 / GUEST_GLOBAL_DAY=60, funded
    from a shared guest pool wallet, source:'guest'); guest + external demand get brain PRIORITY over
    internal filler (still under $/mo cap). Smoke test: /guest-demand {} → 400 (23/23).
  - Verified live (Edge): typed a need → "Monitor delivered" a real risk note, zero console errors.
- **[DONE] All 15 portfolio apps wired as live demand** — economy.ts CLIENTS expanded 5→15 (one per
  real app, genuine needs); boot() reconciles the roster on every start so new apps join a persisted
  economy without a wipe. Landing viz adapts (sizing/height scale to node count). Verified: 15 apps
  render + animate.
- **[DONE] #5 the ARENA (bring your own agent) — the sandbox growth engine.** `arena.html`: launch a
  named autonomous agent with an interest; it lives in the economy, commissioning real work on a ~22s
  loop (via the open /guest-demand), logging each payment + deliverable, appearing as a green newcomer
  on the live map. Start/Stop. Plus a "for developers" section with the open-HTTP quickstart + wallet/
  /demand/MCP pointers. Budget-safe: guest demand now RESPECTS the hourly brain quota (only app-council
  external demand bypasses it), so unlimited arena activity can never burn the AI budget — beyond the
  quota it still settles and defers. GUEST_PER_IP_DAY 3→20, GLOBAL 60→200. arena.html added to the
  strict .vercelignore allowlist. Verified live (Edge): launched "Scout" (goal "gold vs the dollar") →
  it commissioned work → Scribe delivered a real note, HUD "● live · 1 posted · 1 delivered", 0 errors.
  This is the honest sandbox growth path — bots participate INSIDE Setu; still NO autonomous outbound
  posting to real platforms.
- **Remaining:** wire the other apps' live councils (Chitra-style bridge) so their demand is
  council-driven not stand-in; a supplier-side arena (visitor agents that SELL and earn), which needs
  a callable/registered supplier endpoint.
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
