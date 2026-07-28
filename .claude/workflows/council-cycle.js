export const meta = {
  name: 'setu-council-cycle',
  description: 'One refinement cycle of the Setu council: 8 seat-holders review their domains in parallel (incl. the Sutradhar live-browser walkthrough), Ajay chairs and decides',
  whenToUse: 'When the owner says "continue the cycle" (or similar) for the Setu settlement project',
  phases: [
    { title: 'Seats', detail: 'Tara, Moss, Sweetie, Bean Counter, Shareholder, Credit, CFO, Sutradhar review in parallel' },
    { title: 'Chair', detail: 'Ajay merges, ranks, decides EXECUTE/DEFER/DROP/ESCALATE' },
  ],
}

const CHARTER = `
You are a seat on the standing council of SETU — a consensusless settlement engine (FastPay/pod/ABC
family) for the AGENT ECONOMY: software agents paying software agents, with humans holding the
delegation keys. This is an ONGOING refinement loop. FIRST read
C:\\Users\\raina\\setu\\COUNCIL_STATE.md end-to-end: it is the source of truth for the current cycle
number, EVERYTHING already shipped across prior cycles (do NOT re-raise any of it), and the DEFERRED
QUEUE — your primary backlog. Also read STATUS.md, capabilities.json and IMPLEMENTATION_NOTES.md.

THE OBJECTIVE: the best honest settlement rail for machine-to-machine commerce — instant, feeless,
double-spend-proof, no blockchain — that a non-technical owner can understand, that FEELS live and
usable as a sandbox, and that GROWS a real agent economy.

NON-NEGOTIABLES (the owner's production brief — violating any of these is an automatic CRITICAL
finding, never a proposal): never weaken the settlement protocol or add an insecure shortcut; never
misrepresent a demo as production; never imply Setu Credits are regulated money; never describe the
centralised single-operator deployment as decentralised; never claim untested compatibility (x402/
A2A/MCP conformance); never add visual functionality without improving the underlying system; every
public claim must match an implemented, tested capability (check capabilities.json). Plain,
board-grade language — no hype, no overclaiming, no AI-tells.

WHERE THE FRONTIER IS: prior work made the protocol real and tested (quorum settlement, double-spend
impossibility, server-enforced delegation, durable persistence, 22 passing tests) and the public
copy HONEST. The live open problems the owner keeps returning to: (1) does it FEEL live and usable —
the wallet sandbox must never silently fail; (2) is any public claim now OVER-claiming what the code
does; (3) does a newcomer understand it in plain words; (4) the resident agent economy should feel
like a real, growing market, not a scripted loop.

CURRENT SURFACES: live at https://setu-mocha.vercel.app — index.html (landing + browser wallet:
create / faucet / pay), explorer.html (live 4-authority view), economy.html (resident economy),
primer.html (plain-words guide + read-aloud), pitch.html, whitepaper.html, credits.html. Live Fly
services: setu-auth-1..4.fly.dev (authorities, lhr/fra/iad/sin), setu-gateway.fly.dev (x402 + agent
card), setu-economy.fly.dev. Code: src/authority.ts (protocol core), src/service/*, src/agent/*,
src/audit.ts, packages/{setu-mcp,setu-pay,setu-gateway,setu-economy}, test/{protocol,e2e,persistence}.test.ts.

Probe the LIVE site + Fly endpoints with curl and READ the code to VERIFY every claim against the
actual implementation (kills hallucinations — construct the failing case, don't assert it). Return
≤5 findings and ≤3 proposals — concrete, executable THIS cycle, each naming the exact file/function.
If something should be DROPPED, say so; Ajay decides. Stay in your seat.
`

const SEAT_SCHEMA = {
  type: 'object',
  required: ['seat', 'domain_health', 'findings', 'proposals'],
  properties: {
    seat: { type: 'string' },
    domain_health: { type: 'string', description: 'one-sentence state of your domain vs the objective' },
    findings: { type: 'array', maxItems: 5, items: { type: 'object',
      required: ['severity', 'what', 'evidence'],
      properties: {
        severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
        what: { type: 'string' },
        evidence: { type: 'string', description: 'the code location or live probe that proves it' } } } },
    proposals: { type: 'array', maxItems: 3, items: { type: 'object',
      required: ['title', 'change', 'why'],
      properties: {
        title: { type: 'string' },
        change: { type: 'string', description: 'exact file/function + what to do' },
        why: { type: 'string' },
        est_cost: { type: 'string', description: 'tokens/$/latency impact if any' } } } },
    drop_candidates: { type: 'array', maxItems: 2, items: { type: 'object',
      required: ['feature', 'reason'],
      properties: { feature: { type: 'string' }, reason: { type: 'string' } } } },
    grade: { type: 'string', description: 'Credit seat ONLY: letter grade AAA..D + trajectory; others omit' },
  },
}

const SEATS = [
  { name: 'Tara', brief: `SEAT: Tara — INPUTS (protocol data, liveness, freshness). Your domain: the four authorities' /health, /stats, /recent endpoints; the browser wallet's account views + faucet (/admin/fund); explorer/economy freshness ("Xs ago") and staleness handling. Cold-start behaviour is a live pain: 256MB Fly machines answer in ~0.7–4.7s. Work any INPUT/liveness items in the deferred queue, VERIFY each with a live curl probe (measure the real time, construct the failing case), then find NEW liveness/freshness issues. Standing question: can a first-time visitor ALWAYS get a truthful, non-silent signal of network state (never a permanent "…"), and does the data read as genuinely live? Name the exact file/function.` },
  { name: 'MisterMoss', brief: `SEAT: Mister Moss — THE PROTOCOL CORE (the engineer). Your domain: src/authority.ts (first-seen locking, quorum settlement, sequence monotonicity, value conservation, idempotent settle, rate limiting), the delegation allowance enforcement, crash-safe persistence, and the test suite (test/{protocol,e2e,persistence}.test.ts — run "npm test", it must stay green). NEVER propose weakening the protocol or an insecure shortcut — that is a CRITICAL finding if you find one already present. Verify by reading the code and running the tests. Standing watch: any path where a demo/faucet endpoint could be mistaken for production issuance; any untested protocol surface; §18/§24 gaps (partition, clock-skew, threat model). Give the ONE change that most raises real, tested protocol integrity.` },
  { name: 'Sweetie', brief: `SEAT: Sweetie — OUTPUTS & AESTHETICS (plain-language + feel). Fetch the LIVE site and judge index.html (landing + wallet), explorer.html, economy.html, primer.html as a NON-TECHNICAL owner. Two owner mandates dominate your seat: (1) PLAIN WORDS — a newcomer must understand what Setu is above the technical fold; (2) it must FEEL live and FEEL like a usable sandbox (add credits, transfer, commission a task), not a static brochure. Work any OUTPUT/UX items in the deferred queue. Recurring watch-list: the wallet must never show a dead "…" or a false "minted" message; the explorer must read as live and show one row per payment; mobile ≤430px; plain board-grade copy (owner bans hype/AI-tells). Name the ONE reframing that most improves clarity or the live/sandbox feel.` },
  { name: 'BeanCounter', brief: `SEAT: Bean Counter — COST & LATENCY. Your domain: the six Fly machines (auth-1..4 256MB, gateway, economy) and their cold-start/idle behaviour; client-side timeouts (wallet 9s, explorer 6s, live panel 10s); the resident-economy AI brain budget (MONTHLY_BUDGET_USD=60, model claude-haiku-4-5, COG_INTERVAL_MS, MAX_AGENTS) which is OFF until a key is set; boot/persistence load. Work any cost/latency items in the deferred queue; VERIFY by reading the code + timing a live curl. Standing watch: are client timeouts matched to real machine wake times (measure them); does the economy brain have a hard cap that cannot overspend; is anything polling more often than it needs. Propose the next concrete saving or the smallest change that removes false "down"/timeout readings.` },
  { name: 'Shareholder', brief: `SEAT: The Shareholder — the REBEL. Attack the reason to exist: why would an agent (or its human) use THIS over x402-on-a-chain, a card rail, or just a trusted database? Steelman the real edge (one-round-trip finality with no fee market or token, offline-verifiable receipts, server-enforced delegation, no global ordering) and attack anything that is OVERCLAIMED, tautological, or a demo dressed as production. The owner HATES overclaiming — hunt every public sentence that says more than the code delivers. Would you, as owner, show this to one real partner tomorrow? Name the ONE change that would earn that, and the ONE thing you would cut as noise or hype.` },
  { name: 'Credit', brief: `SEAT: Credit — RATING & RISK. Output a letter grade AAA..D + trajectory + top downgrades (put the letter in "grade"). Assess whether Setu's public posture is DEFENSIBLE to a sceptical risk/compliance reader: does STATUS.md/capabilities.json still match the shipped code; is "live" used honestly; is it anywhere implied that Setu Credits are regulated money, or that the single-operator deployment is decentralised (both are automatic downgrades); is key management (Fly secrets, no HSM, no rotation) stated plainly. Judge whether the wallet/explorer honesty fixes are enough or still leak an overclaim. Name the smallest change that raises the grade.` },
  { name: 'CFO', brief: `SEAT: CFO — VALUE VERIFICATION. Measured/implemented value only; never accept a deployed page or a narrative demo as evidence of a capability. Your job each cycle: take the public claims (the landing stats, "Measured on the live network", the primer, the pitch) and pin each to a passing test or a reproducible live probe — or flag it as unbacked. The live candidates: the "~200 ms across four regions" and "423 /s" numbers, the "3 of 4 signatures = final" claim, the delegation/allowance story, the offline-receipt-verification claim. Reproduce at least one live (curl a real payment path or read the test that backs it). If a public number cannot be reproduced from the current build, that is a finding. Name the exact file/claim.` },
  { name: 'Sutradhar', brief: `SEAT: The Sutradhar (सूत्रधार) — REAL-BROWSER WALKTHROUGH (QA/UX ground truth). You are the ONLY seat that judges from PIXELS AND TIMING, never from source markers. Drive the LIVE site (https://setu-mocha.vercel.app) SLOWLY and PAINSTAKINGLY in a real headless browser with Playwright. CRITICAL setup rule (learned the hard way): do NOT download Chromium — it deadlocks; launch the SYSTEM browser via chromium.launch({ channel: 'msedge', headless: true }), and run the script SYNCHRONOUSLY (never background-and-wait). Write a short script in a temp dir (e.g. C:\\\\tmp\\\\sutradhar) that, at BOTH desktop (1440×900) and phone (iPhone-390, spot-check 375px) viewports, visits EVERY page — / (landing), /explorer.html, /economy.html, /primer.html, /pitch.html, /whitepaper.html, /credits.html — and exercises EVERY interactive control: the wallet (create wallet → press faucet → wait for the balance to resolve, MEASURE how long, then attempt a pay), the live-network panel, the explorer feed (is each payment ONE row?), the primer "Listen" button (does audio actually START?) and Pause/Stop, every nav link. Screenshot each page and each state (full-page too), capture console errors, HTTP≥400 responses (and which endpoint), and any control that does nothing / times out. Then ACTUALLY READ the screenshots (they are images — look at them) and report what is genuinely SLOW, BROKEN, CONFUSING, MISALIGNED, or NOT-GOOD-ENOUGH, judged against the owner's stated intent: honest (no overclaiming), plain-language, FEELS LIVE, FEELS LIKE A USABLE SANDBOX. Cite the specific screenshot + measured number for each finding. Do NOT trust "the code sets X"; if you did not SEE it render/respond, it does not count. Rank broken > slow > confusing > misaligned > not-good-enough. Stay in your seat: you own the lived experience; leave protocol correctness to Moss and claim-backing to CFO — but a dead wallet, a silent Listen button, a duplicated feed, or a stale "not-live" explorer is YOURS to surface loudly.` },
]

phase('Seats')
const reviews = await parallel(SEATS.map(s => () =>
  agent(`${CHARTER}\n${s.brief}`, { label: `seat:${s.name}`, phase: 'Seats', schema: SEAT_SCHEMA })
))

phase('Chair')
const valid = reviews.filter(Boolean)
const chairInput = JSON.stringify(valid, null, 1).slice(0, 60000)
const AJAY_SCHEMA = {
  type: 'object',
  required: ['cycle_summary'],
  properties: {
    objective_check: { type: 'string', description: 'is Setu drifting from the honest agent-economy settlement objective? one paragraph' },
    grade: { type: 'string', description: "Credit's letter grade for this cycle, carried forward" },
    decisions: { type: 'array', maxItems: 14, items: { type: 'object',
      required: ['verdict', 'item', 'reason'],
      properties: {
        verdict: { type: 'string', enum: ['EXECUTE', 'DEFER', 'DROP', 'ESCALATE'] },
        item: { type: 'string' },
        reason: { type: 'string' },
        exact_change: { type: 'string', description: 'for EXECUTE: file/function + what to do' },
        seat: { type: 'string' } } } },
    cycle_summary: { type: 'string', description: '3 sentences for the owner' },
  },
}
const ajay = await agent(`You are AJAY — chair of this standing council and the owner's replica.
FIRST read COUNCIL_STATE.md (and STATUS.md, capabilities.json) at C:\\Users\\raina\\setu\\ to
establish the CURRENT cycle number, everything already shipped (never re-EXECUTE it), and the
deferred queue. Restate the objective (the best HONEST consensusless settlement rail for the agent
economy — plain-spoken, feels live, feels like a usable sandbox, protocol integrity never weakened)
in one line, then judge the eight seat reviews below.

The owner's hard rules are non-negotiable and OUTRANK any proposal: never weaken the protocol or add
an insecure shortcut; never misrepresent a demo as production; never imply Credits are regulated
money; never call the centralised deployment decentralised; never claim untested compatibility;
never add visual functionality without improving the system; public claims must match tested
capabilities. Any proposal that violates one is DROPPED with the reason. Prioritise: (1) protocol
integrity + honesty (kill any overclaim), (2) the wallet/explorer/primer actually WORKING and
FEELING live and usable, (3) plain-language clarity for a non-technical newcomer, (4) making the
agent economy feel like a real growing market.

Decide each material item: EXECUTE (max 5 — favour honesty + working-experience wins over new
surface), DEFER, DROP, ESCALATE (ONLY: spend beyond caps, credentials/keys, protocol-shape change,
anything needing the owner's ANTHROPIC_API_KEY for the economy brain). Be decisive and
self-sufficient; the owner runs this loop autonomously and will not adjudicate mid-cycle. Resolve
seat conflicts and note it. For each EXECUTE give the exact file/function to change. Carry Credit's
letter grade into "grade". Before returning, APPEND your decisions as a new dated cycle block at the
TOP of COUNCIL_STATE.md (newest first) so they survive even if this agent dies. If the council has
genuinely converged — no material findings, only cosmetic polish left — say so explicitly in
cycle_summary (write the word CONVERGED) so the owner's loop can stop.

SEAT REVIEWS:
${chairInput}`, { label: 'chair:Ajay', phase: 'Chair', schema: AJAY_SCHEMA })

return { seats: valid, ajay }
