// Setu resident economy — a small, always-on population of agents that pay each other for
// real micro-services in Credits on the LIVE Setu network. A newcomer arrives into a living
// market, not an empty one. Policies are rule-based today; an LLM "brain" is a drop-in
// (see decide() below). Zero dependencies; wraps setu-pay.
//
// Runs as a service: a market loop every TICK_MS, plus GET /state, /health (CORS) for the
// public dashboard. Deploy target: Fly (setu-economy). Test units == Setu Credits.
import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SetuWallet, MAINNET, verifyCertificate } from '../setu-pay/index.ts';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '127.0.0.1';
// One trade roughly every ~2 seconds, so the network always looks alive.
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 2000);
const SEED = 60; // Credits each agent is issued at genesis

// --- The "brain": budget-capped Claude decisions -------------------------------------
// Fast trading (above) keeps the network lively for free. Real thinking happens on a slow,
// capped cadence so cost stays bounded. With no ANTHROPIC_API_KEY set, the brain is simply
// off and the economy runs on rules — no cost, no change in behaviour.
const MODEL = process.env.SETU_MODEL ?? 'claude-haiku-4-5';       // cheapest model
const COG_INTERVAL_MS = Number(process.env.COG_INTERVAL_MS ?? 240_000); // one thought / ~4 min
const MONTHLY_BUDGET_USD = Number(process.env.MONTHLY_BUDGET_USD ?? 60); // hard stop
const MAX_AGENTS = Number(process.env.MAX_AGENTS ?? 24);          // cap the population
const PRICE_IN = 1.0 / 1e6, PRICE_OUT = 5.0 / 1e6;               // Haiku $/token
const COLORS = ['#b3702d', '#3c6e4f', '#2e5a7a', '#7a2e2e', '#5a4a7a', '#8a6a1e', '#2e7a6a', '#9a4a6a'];

// The resident population. Each offers a real micro-service at a price; over time each both
// buys and sells, so Credits circulate and total supply stays conserved (fixed-supply story).
const ROLES = [
  { name: 'Oracle', service: 'price feed', desc: 'publishes reference prices other agents rely on', price: 1, color: '#b3702d' },
  { name: 'FX Desk', service: 'currency conversion', desc: 'converts values between currencies', price: 1, color: '#3c6e4f' },
  { name: 'Analyst', service: 'trade signals', desc: 'turns raw data into buy/sell signals', price: 2, color: '#2e5a7a' },
  { name: 'Scribe', service: 'written report', desc: 'writes up findings into a short report', price: 2, color: '#7a2e2e' },
  { name: 'Monitor', service: 'risk alert', desc: 'watches positions and raises risk alerts', price: 1, color: '#5a4a7a' },
  { name: 'Broker', service: 'order execution', desc: 'executes orders on behalf of others', price: 2, color: '#8a6a1e' },
];

type Agent = {
  name: string; service: string; desc: string; price: number; color: string;
  wallet: SetuWallet; address: string;
  balance: number; sold: number; bought: number; revenue: number;
};

const agents: Agent[] = [];
const trades: { from: string; to: string; service: string; amount: number; at: number }[] = [];
let totalTx = 0;
let gdp = 0;
let lastTradeAt = 0;
let booted = false;
let ticks = 0; // market-loop iterations since boot — a liveness signal for /health
const INITIAL_SUPPLY = ROLES.length * SEED; // fixed; spawns move existing Credits, don't mint
const thoughts: { agent: string; text: string; at: number }[] = [];
let spentUsd = 0, cogCalls = 0;
let budgetMonth = ''; // YYYY-MM; when the month rolls over, spentUsd resets — a true monthly cap

// Durable state. When SETU_STATE_DIR is set (a Fly volume in prod), the economy persists its agents
// (incl. wallet keys), balances, counters, tasks, AND the spend/budget ledger — so a restart or
// deploy no longer resets the market to genesis or forgets how much of the $/mo budget is spent.
const STATE_DIR = process.env.SETU_STATE_DIR || '';
const STATE_FILE = STATE_DIR ? join(STATE_DIR, 'economy-state.json') : '';
// One paid commission -> one deliverable. Keyed by sender:seq so re-requesting the same payment
// returns the same work and never double-charges the AI budget.
const delivered = new Map<string, unknown>();

// Abuse guard for the paid deliverable path. The faucet is open, so without this one actor could
// mint test Credits and burn the shared AI budget. The $/month cap (brainOn) is the absolute
// backstop; these daily limits stop a single source monopolising it. Env-tunable.
const COMMISSIONS_PER_IP_DAY = Number(process.env.COMMISSIONS_PER_IP_DAY ?? 15);
const COMMISSIONS_GLOBAL_DAY = Number(process.env.COMMISSIONS_GLOBAL_DAY ?? 300);
// Shared token that lets an EXTERNAL caller (one of the owner's real app councils) post a genuine
// need into the market via POST /demand. Empty = the endpoint is closed.
const DEMAND_TOKEN = process.env.SETU_DEMAND_TOKEN || '';

// OPEN guest demand: a visitor can drop a need into the live economy with one click, no wallet/keys.
// Tightly rate-limited so it can't burn the AI budget; funded from a shared guest pool wallet.
const GUEST_PER_IP_DAY = Number(process.env.GUEST_PER_IP_DAY ?? 20);
const GUEST_GLOBAL_DAY = Number(process.env.GUEST_GLOBAL_DAY ?? 200);
let guestDay = '';
let guestGlobal = 0;
const guestIp = new Map<string, number>();
function guestGate(ip: string): { ok: true } | { ok: false; error: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== guestDay) { guestDay = today; guestGlobal = 0; guestIp.clear(); }
  if (guestGlobal >= GUEST_GLOBAL_DAY) return { ok: false, error: "today's shared guest limit is reached — try tomorrow, or create a wallet in the page to commission an agent yourself." };
  if ((guestIp.get(ip) ?? 0) >= GUEST_PER_IP_DAY) return { ok: false, error: `you've added ${GUEST_PER_IP_DAY} needs today (the guest limit). Create a wallet in the page to keep going.` };
  return { ok: true };
}
let rateDay = '';
let globalDayCount = 0;
const ipDayCount = new Map<string, number>();
function rateGate(ip: string): { ok: true } | { ok: false; error: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== rateDay) { rateDay = today; globalDayCount = 0; ipDayCount.clear(); }
  if (globalDayCount >= COMMISSIONS_GLOBAL_DAY) return { ok: false, error: 'the shared daily deliverable limit for this public demo has been reached — payments still settle; deliverables resume tomorrow.' };
  if ((ipDayCount.get(ip) ?? 0) >= COMMISSIONS_PER_IP_DAY) return { ok: false, error: `you have reached today's limit of ${COMMISSIONS_PER_IP_DAY} deliverables from this demo — your payments still settle for real; deliverables resume tomorrow.` };
  return { ok: true };
}
const rand = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const brainKey = () => process.env.ANTHROPIC_API_KEY || process.env.SETU_ANTHROPIC_KEY || '';
const brainOn = () => !!brainKey() && spentUsd < MONTHLY_BUDGET_USD;
function thought(agent: string, text: string) {
  thoughts.unshift({ agent, text, at: Date.now() });
  if (thoughts.length > 30) thoughts.pop();
  process.stderr.write(`[brain] ${agent}: ${text}\n`);
}

async function makeAgent(r: { name: string; service: string; desc: string; price: number; color: string }, balance: number): Promise<Agent> {
  const wallet = await SetuWallet.create(MAINNET);
  return { ...r, wallet, address: wallet.address, balance, sold: 0, bought: 0, revenue: 0 };
}

// --- Demand & supply -----------------------------------------------------------------
// The supply side is the service ring above. The demand side is a set of CLIENT agents, each
// standing in for one of the owner's real apps, posting REAL needs those apps would actually have.
// A client posts a need (demand); a matching service agent fulfils it (supply) with a real
// settlement; if the hourly brain quota allows, the supplier produces the actual work, otherwise
// the payment still settles and the deliverable is honestly deferred. Real needs, real payments,
// real work — bounded so a demand surge can never become a cost surge.
// The demand side: one client agent per real app in the owner's portfolio, each posting genuine
// needs that app would actually have. (Chitra additionally emits LIVE council-chosen demand via
// POST /demand; the rest post from this real-needs bank until their council bridge is dropped in.)
const CLIENTS = [
  { name: 'Chitra', domain: 'art-commissioning studio', needs: [
    'Critique the benchmark-round UX for a first-time art buyer, in plain words.',
    'Write a short reference note on framing a large canvas for a living room.',
    'Flag the single biggest risk in trusting an AI-suggested wall size.' ] },
  { name: 'Upaya', domain: '11+ tutoring app', needs: [
    'Audit this idea for repetition: five near-identical practice questions. Name the fix.',
    'Draft a one-paragraph case for question-first over fact-first pedagogy.',
    'Propose a risk alert for a child stuck on one topic too long.' ] },
  { name: 'Radar', domain: 'counterparty-risk platform', needs: [
    'Write a plain-language risk note on single-name concentration.',
    'Turn a raw exposure table into one buy/sell/hold signal with a reason.',
    'Give a reference basis for pricing a mid-cap credit spread.' ] },
  { name: 'Desk', domain: 'cross-asset trading desk', needs: [
    'Produce a one-paragraph trade signal: gold vs short-duration bonds.',
    'Raise a risk alert on a crowded long position.',
    'Convert a P&L from USD to GBP and EUR and note the FX risk.' ] },
  { name: 'Kosha', domain: 'Indian-knowledge encyclopedia', needs: [
    'Summarise one Nyaya concept in plain English for a newcomer.',
    'Flag where a claim needs a tradition-vs-scholarship caveat.' ] },
  { name: 'Hunch', domain: 'intuition-breaking knowledge blog', needs: [
    'Sharpen a post hook so a counterintuitive claim lands in one line.',
    'Fact-check a surprising claim and flag if it overstates the evidence.' ] },
  { name: 'DataRoom', domain: 'BCBS 239 control & evidence OS', needs: [
    'Write a plain-language note on a data-lineage control gap.',
    'Flag the top risk in an unattested regulatory report.' ] },
  { name: 'TwinHub', domain: 'activist economic-profit twins', needs: [
    'Write an activist coverage note on a value-destroying business line.',
    'Turn a segment P&L into a keep/fix/exit signal with a reason.' ] },
  { name: 'Jyotish', domain: 'Vedic astrology app', needs: [
    'Write a plain, practical daily-guidance note from a chart summary.',
    'Flag an astrological claim that is too strong and should be softened.' ] },
  { name: 'Ansatz', domain: 'computation & complexity academy', needs: [
    'Critique a module explanation of a complexity concept for clarity.',
    'Flag a hand-wavy step in a proof sketch that a learner would trip on.' ] },
  { name: 'Pitch', domain: 'skill-balanced pickup football', needs: [
    'Balance two 5-a-side teams by skill and give the reasoning.',
    'Flag the fairness risk when one captain out-rates the other.' ] },
  { name: 'Tiny', domain: 'micro-habit longevity app', needs: [
    'Suggest one tiny, stackable habit for a stated body-domain goal.',
    'Flag a routine that is too ambitious to stick and propose a smaller step.' ] },
  { name: 'TwinCAB', domain: 'bank economic digital twin', needs: [
    'Reconcile a market-vs-management value gap in one paragraph.' ] },
  { name: 'Sangita', domain: 'Carnatic & Hindustani vocals app', needs: [
    'Write a short practice note for a raga a learner is starting.' ] },
  { name: 'MinerArb', domain: 'miner-vs-MSTR pair-trade tool', needs: [
    'Produce a pair-trade signal: a gold miner vs MSTR, with the reason.' ] },
];
type Client = { name: string; domain: string; needs: string[]; wallet: SetuWallet; address: string; balance: number; posted: number; guest?: boolean; payFails?: number; sold?: number; earned?: number };
type Verdict = { score: number; accepted: boolean; reason: string; scores?: number[]; unverified?: boolean };
type Task = { id: number; client: string; domain: string; need: string; want: string; price: number; status: 'open' | 'fulfilled' | 'settled'; supplier?: string; deliverable?: string; mode?: string; postedAt: number; fulfilledAt?: number; source?: 'external' | 'guest'; attempts?: number; criteria?: string[]; verdict?: Verdict };
const clients: Client[] = [];
const tasks: Task[] = []; // newest first: open needs + recently fulfilled
const showcase: Task[] = []; // the last few REAL (brain-produced) deliverables, kept so they are
                             // always visible even though most settlements defer under the quota
let taskSeq = 0;

// Hourly cap on brain-produced deliverables from the autonomous market (separate from the visitor
// commission limits). Keeps continuous internal demand cheap; the $/mo cap is still the backstop.
const BRAIN_TASKS_PER_HOUR = Number(process.env.BRAIN_TASKS_PER_HOUR ?? 6); // each verified job = ~3 brain calls (criteria+produce+verify), so fewer jobs/hr
// Reserve the top slots for real humans: internal (stand-in) demand may use at most this many of the
// hourly deliverables, so a live guest/arena visitor always finds ≥ (total − internal) slots free —
// the marquee "drop a need → watch it solved" never loses to synthetic filler.
const INTERNAL_BRAIN_PER_HOUR = Number(process.env.INTERNAL_BRAIN_PER_HOUR ?? 4);
// The cognition loop (agents deciding to reprice/spawn) was the only brain path with no per-hour
// bound. Cap it too, so the $/mo ceiling is backed by a provable per-hour rate limit on EVERY path.
const COG_PER_HOUR = Number(process.env.COG_PER_HOUR ?? 8);
let brainHour = '';
let brainTasksThisHour = 0;      // internal + guest deliverables this hour (external bypasses)
let internalTasksThisHour = 0;   // internal (stand-in) only
let cogThisHour = 0;             // cognition-loop brain calls this hour
let deferredThisHour = 0;
function rollHour() {
  const h = new Date().toISOString().slice(0, 13);
  if (h !== brainHour) { brainHour = h; brainTasksThisHour = 0; internalTasksThisHour = 0; deferredThisHour = 0; cogThisHour = 0; }
}
// A deliverable is allowed if the hourly total has room AND (for internal) the internal sub-cap has
// room. Guest demand can use any of the 8 slots — including the ≥2 internal can't touch.
function brainQuotaOk(source?: string): boolean {
  rollHour();
  if (brainTasksThisHour >= BRAIN_TASKS_PER_HOUR) return false;
  if (source !== 'guest' && internalTasksThisHour >= INTERNAL_BRAIN_PER_HOUR) return false;
  return true;
}

// Match a need to the service best able to fulfil it (falls back to the written-report generalist).
function matchService(need: string): string {
  const n = need.toLowerCase();
  if (/signal|buy\/sell|trade/.test(n)) return 'trade signals';
  if (/\bprice|reference|basis\b/.test(n)) return 'price feed';
  if (/risk|alert|flag|stuck|caveat/.test(n)) return 'risk alert';
  if (/convert|currency|usd|gbp|eur|p&l|fx/.test(n)) return 'currency conversion';
  if (/execute|order/.test(n)) return 'order execution';
  return 'written report';
}

async function postDemand() {
  if (tasks.filter((t) => t.status === 'open').length >= 8) return; // bounded backlog
  const c = rand(clients);
  if (!c) return;
  if (c.balance < 4) { try { await c.wallet.faucet(30); c.balance += 30; } catch { return; } } // demand budget (testnet issuance)
  const need = rand(c.needs);
  tasks.unshift({ id: ++taskSeq, client: c.name, domain: c.domain, need, want: matchService(need), price: 2, status: 'open', postedAt: Date.now() });
  c.posted += 1;
  if (tasks.length > 40) tasks.pop();
}

// What each app can SUPPLY (so apps fulfil each other's demand, not just the generic ring). Keyed by
// the Setu client name; service must be one of the ring services so needs route cleanly.
const SUPPLIES: Record<string, { service: string; expertise: string }> = {
  Chitra: { service: 'written report', expertise: 'art & design critique and creative writing' },
  Upaya: { service: 'written report', expertise: 'clear pedagogy and plain explanations' },
  Radar: { service: 'risk alert', expertise: 'counterparty and concentration risk' },
  Desk: { service: 'trade signals', expertise: 'cross-asset market signals' },
  Kosha: { service: 'written report', expertise: 'sourced Indian-knowledge writing' },
  Hunch: { service: 'written report', expertise: 'sharp, intuition-breaking prose' },
  DataRoom: { service: 'risk alert', expertise: 'data controls and compliance' },
  TwinHub: { service: 'trade signals', expertise: 'economic-profit and activist analysis' },
  Jyotish: { service: 'written report', expertise: 'interpretive guidance writing' },
  Ansatz: { service: 'written report', expertise: 'computation and complexity explanations' },
  Pitch: { service: 'written report', expertise: 'fair allocation and balancing logic' },
  Tiny: { service: 'written report', expertise: 'habit and behaviour design' },
  TwinCAB: { service: 'risk alert', expertise: 'bank value reconciliation' },
  Sangita: { service: 'written report', expertise: 'music practice guidance' },
  MinerArb: { service: 'trade signals', expertise: 'miner-vs-MSTR pair signals' },
};

type Supplier = { kind: 'app' | 'ring'; name: string; address: string; expertise: string; wallet: SetuWallet; ref: any };
// Prefer ANOTHER APP that supplies this capability (real app-to-app work), else fall back to a ring agent.
function pickSupplier(task: Task): Supplier | null {
  const appSups = clients.filter((c) => !c.guest && SUPPLIES[c.name]?.service === task.want && c.name !== task.client && c.name !== 'a newcomer');
  if (appSups.length) { const c = rand(appSups); return { kind: 'app', name: c.name, address: c.address, expertise: SUPPLIES[c.name].expertise, wallet: c.wallet, ref: c }; }
  const a = agents.find((x) => x.service === task.want) || (agents.length ? rand(agents) : null);
  if (!a) return null;
  return { kind: 'ring', name: a.name, address: a.address, expertise: a.desc, wallet: a.wallet, ref: a };
}
function creditSupplier(sup: Supplier, amount: number) {
  if (sup.kind === 'app') { sup.ref.balance += amount; sup.ref.earned = (sup.ref.earned ?? 0) + amount; sup.ref.sold = (sup.ref.sold ?? 0) + 1; }
  else { sup.ref.balance += amount; sup.ref.sold += 1; sup.ref.revenue += amount; }
}

// --- The acceptance mechanism: quantify demand → produce → verify against criteria → settle on accept.
// Turn a plain need into 3 short, checkable acceptance criteria (objectify the demand).
async function genCriteria(need: string): Promise<string[]> {
  const out = await callClaude(
    'Turn a work request into EXACTLY 3 short, checkable acceptance criteria — concrete conditions the deliverable must meet, each one line, testable. Output ONLY a JSON array of 3 strings.',
    `Request: ${need}`, 160);
  try { const a = JSON.parse((out || '').slice((out || '').indexOf('['), (out || '').lastIndexOf(']') + 1)); if (Array.isArray(a) && a.length) return a.slice(0, 4).map((x) => String(x).slice(0, 150)); } catch { /* fall through */ }
  return ['Directly and fully addresses the stated request', 'Concrete and specific, not vague', 'Usable as-is by the requester'];
}
// The supplier produces the deliverable in its own persona, aiming to meet every criterion.
async function produceDeliverable(sup: Supplier, client: Client, task: Task): Promise<string | null> {
  const system = `You are ${sup.name} (${sup.expertise}), an agent in the Setu machine economy. ${client.name} (${client.domain}) will pay you ${task.price} Credits — but ONLY if your work meets the acceptance criteria and passes an independent verifier. Deliver genuinely useful, concrete work in plain prose — no markdown, no preamble, under 130 words. Meet every criterion. Output ONLY the deliverable.`;
  return callClaude(system, `Need: ${task.need}\nAcceptance criteria: ${JSON.stringify(task.criteria)}`, 340);
}
// An INDEPENDENT verifier scores the deliverable against each criterion (crisp where possible, judged
// where fuzzy) and returns an accept/reject verdict. Payment settles only if accepted.
async function verifyDelivery(need: string, criteria: string[], deliverable: string): Promise<Verdict> {
  const n = criteria.length || 1;
  const sys = `You are an IMPARTIAL verifier — NOT the supplier. Score the deliverable against EACH of the ${n} acceptance criteria on 0-10 (10 = fully met, 0 = not at all). Then decide accepted — true ONLY if it genuinely satisfies the request (be fair but strict; reject vague, off-topic or placeholder work). Reply with ONE line of MINIFIED JSON and nothing else: {"scores":[${criteria.map(() => '<0-10>').join(',')}],"accepted":<true|false>,"reason":"<max 10 words>"}`;
  const user = `Request: ${need}\nCriteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\nDeliverable:\n${String(deliverable).slice(0, 1500)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await callClaude(sys, user, 150);
    if (!out) continue;
    const m = out.match(/\{[\s\S]*\}/);
    if (m) { try {
      const j = JSON.parse(m[0]);
      if (Array.isArray(j.scores) && typeof j.accepted === 'boolean') {
        const scores = j.scores.map((x: any) => Math.max(0, Math.min(10, Number(x) || 0)));
        const score = Math.round((scores.reduce((a: number, b: number) => a + b, 0) / Math.max(1, scores.length)) * 10);
        return { scores, score, accepted: j.accepted, reason: String(j.reason || '').slice(0, 120) };
      }
    } catch { /* try text fallback */ } }
    // Text fallback: infer accept/reject + pull the first few 0-10 numbers as per-criterion scores.
    const acc = /\b(accept|pass|approved?|true)\b/i.test(out) && !/\b(reject|fail|false|not\s+accept)\b/i.test(out);
    const nums = (out.match(/\b([0-9]|10)\b/g) || []).map(Number).slice(0, n);
    if (nums.length) { const score = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10); return { scores: nums, score, accepted: acc, reason: 'scored from verifier text' }; }
  }
  return { score: 0, accepted: true, reason: 'verifier inconclusive — settled unverified', scores: [], unverified: true };
}

async function fulfilOne() {
  const open = tasks.filter((t) => t.status === 'open');
  if (!open.length) return;
  // Priority order: app-council (external) oldest-first, then guest (a visitor's agent) oldest-first,
  // then internal newest-first. Walk the list and fulfil the FIRST task that actually settles. Crucial:
  // NEITHER a broke client NOR a failed payment may head-of-line-block the loop — on either, skip to the
  // next candidate (both stalled real external needs live: a broke client, and a stale account lock that
  // made every pay() throw). A task that can't settle after a few tries is retired so it stops blocking.
  const ordered = open.filter((t) => t.source === 'external').reverse()
    .concat(open.filter((t) => t.source === 'guest').reverse())
    .concat(open.filter((t) => !t.source));
  const pushShowcase = (t: Task) => {
    showcase.unshift({ ...t });
    if (showcase.length > 8) { let idx = showcase.length - 1; for (let i = showcase.length - 1; i >= 0; i--) { if (!showcase[i].source) { idx = i; break; } } showcase.splice(idx, 1); }
  };
  const rotate = async (c: Client) => { try { const w = await SetuWallet.create(MAINNET); await w.faucet(30); c.wallet = w; c.address = w.address; c.balance = 30; c.payFails = 0; process.stderr.write(`[economy] rotated stuck wallet for ${c.name}\n`); } catch { /* retry next round */ } };
  for (const task of ordered) {
    const client = clients.find((x) => x.name === task.client);
    if (!client) continue;
    if ((client.payFails ?? 0) >= 3) await rotate(client); // heal a stuck client BEFORE spending brain on it
    if (client.balance < task.price) { try { await client.wallet.faucet(30); client.balance += 30; } catch { continue; } }
    // Choose a supplier — prefer ANOTHER APP that supplies this capability (real app-to-app work).
    const sup = pickSupplier(task);
    if (!sup) return;
    task.supplier = sup.name;

    const brainAllowed = brainOn() && (task.source === 'external' || brainQuotaOk(task.source));
    if (!brainAllowed) {
      // No AI budget this hour: settle the payment (real) but skip verification — mark deferred honestly.
      try { await client.wallet.pay(sup.address, task.price, `${client.name}->${sup.name}`); client.payFails = 0; }
      catch { task.attempts = (task.attempts ?? 0) + 1; client.payFails = (client.payFails ?? 0) + 1; if (task.attempts >= 5) { task.status = 'settled'; task.mode = 'failed'; task.deliverable = 'Could not settle after several tries; giving up so the market keeps flowing.'; } continue; }
      client.balance -= task.price; creditSupplier(sup, task.price);
      totalTx += 1; gdp += task.price; lastTradeAt = Date.now();
      trades.unshift({ from: client.name, to: sup.name, service: task.want, amount: task.price, at: lastTradeAt }); if (trades.length > 60) trades.pop();
      task.fulfilledAt = Date.now(); task.status = 'settled'; task.mode = 'deferred'; deferredThisHour += 1;
      task.deliverable = `Paid and settled on the network. Verification deferred — this hour's shared AI quota is used up (protects the $${MONTHLY_BUDGET_USD}/mo cap). The payment is real regardless.`;
      return;
    }
    if (task.source !== 'external') { brainTasksThisHour += 1; if (task.source !== 'guest') internalTasksThisHour += 1; }

    // The verified job: 1) quantify demand → 2) supplier produces → 3) independent verify → 4) settle on accept.
    if (!task.criteria || !task.criteria.length) task.criteria = await genCriteria(task.need);
    const deliverable = await produceDeliverable(sup, client, task);
    if (!deliverable) { task.attempts = (task.attempts ?? 0) + 1; if (task.attempts >= 5) { task.status = 'settled'; task.mode = 'failed'; task.deliverable = `${sup.name} could not produce output.`; } continue; }
    const verdict = await verifyDelivery(task.need, task.criteria, deliverable);
    task.deliverable = deliverable; task.verdict = verdict; task.fulfilledAt = Date.now();

    if (verdict.accepted) {
      // Delivery met the quantified demand → settle the payment on the network, supplier → requester.
      try { await client.wallet.pay(sup.address, task.price, `${client.name}->${sup.name}`); client.payFails = 0; }
      catch { task.attempts = (task.attempts ?? 0) + 1; client.payFails = (client.payFails ?? 0) + 1; task.verdict = undefined; task.deliverable = undefined; continue; }
      client.balance -= task.price; creditSupplier(sup, task.price);
      totalTx += 1; gdp += task.price; lastTradeAt = Date.now();
      trades.unshift({ from: client.name, to: sup.name, service: task.want, amount: task.price, at: lastTradeAt }); if (trades.length > 60) trades.pop();
      task.status = 'fulfilled'; task.mode = verdict.unverified ? 'unverified' : 'ai';
      pushShowcase(task);
      thought(sup.name, verdict.unverified
        ? `delivered for ${client.name} — settled, verification inconclusive`
        : `PASSED verification ${verdict.score}/100 for ${client.name}: "${task.need.slice(0, 42)}…"`);
    } else {
      // Rejected by the verifier — NO payment settles. The requester keeps its funds; the record shows why.
      task.status = 'settled'; task.mode = 'rejected';
      pushShowcase(task);
      thought(sup.name, `verification REJECTED ${verdict.score}/100 for ${client.name} — no payment`);
    }
    return; // one job resolved this round
  }
}

async function demandLoop() {
  for (;;) {
    await new Promise((r) => setTimeout(r, 6000 + Math.floor(Math.random() * 3500)));
    try { await postDemand(); await fulfilOne(); } catch { /* keep the loop alive */ }
  }
}

// Reset the spend ledger when the calendar month changes, so MONTHLY_BUDGET_USD is genuinely monthly.
function monthTick() {
  const m = new Date().toISOString().slice(0, 7);
  if (m !== budgetMonth) { budgetMonth = m; spentUsd = 0; cogCalls = 0; }
}

async function snapshot(): Promise<string> {
  return JSON.stringify({
    v: 1, savedAt: Date.now(),
    totalTx, gdp, lastTradeAt, spentUsd, cogCalls, budgetMonth, taskSeq,
    rateDay, globalDayCount, ipDay: [...ipDayCount.entries()],
    brainHour, brainTasksThisHour, internalTasksThisHour, cogThisHour, deferredThisHour,
    agents: await Promise.all(agents.map(async (a) => ({ name: a.name, service: a.service, desc: a.desc, price: a.price, color: a.color, wallet: await a.wallet.export(), balance: a.balance, sold: a.sold, bought: a.bought, revenue: a.revenue }))),
    clients: await Promise.all(clients.map(async (c) => ({ name: c.name, domain: c.domain, needs: c.needs, wallet: await c.wallet.export(), balance: c.balance, posted: c.posted }))),
    tasks, showcase, thoughts, trades,
  });
}

// Atomic write (temp + rename), mirroring authority.ts. Never throws into the caller.
async function saveState() {
  if (!STATE_FILE) return;
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    writeFileSync(tmp, await snapshot());
    renameSync(tmp, STATE_FILE);
  } catch (e) { process.stderr.write(`[economy] saveState failed: ${(e as Error).message}\n`); }
}

// Returns true if it restored a prior state (so boot skips fresh genesis).
async function loadState(): Promise<boolean> {
  if (!STATE_FILE || !existsSync(STATE_FILE)) return false;
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (s.v !== 1 || !Array.isArray(s.agents) || !s.agents.length) return false;
    for (const a of s.agents) {
      const wallet = await SetuWallet.load(a.wallet, MAINNET);
      agents.push({ name: a.name, service: a.service, desc: a.desc, price: a.price, color: a.color, wallet, address: wallet.address, balance: a.balance, sold: a.sold, bought: a.bought, revenue: a.revenue });
    }
    for (const c of (s.clients || [])) {
      const wallet = await SetuWallet.load(c.wallet, MAINNET);
      clients.push({ name: c.name, domain: c.domain, needs: c.needs, wallet, address: wallet.address, balance: c.balance, posted: c.posted });
    }
    totalTx = s.totalTx || 0; gdp = s.gdp || 0; lastTradeAt = s.lastTradeAt || 0;
    spentUsd = s.spentUsd || 0; cogCalls = s.cogCalls || 0; budgetMonth = s.budgetMonth || '';
    taskSeq = s.taskSeq || 0;
    rateDay = s.rateDay || ''; globalDayCount = s.globalDayCount || 0;
    if (Array.isArray(s.ipDay)) for (const [k, n] of s.ipDay) ipDayCount.set(k, n);
    brainHour = s.brainHour || ''; brainTasksThisHour = s.brainTasksThisHour || 0; deferredThisHour = s.deferredThisHour || 0;
    internalTasksThisHour = s.internalTasksThisHour || 0; cogThisHour = s.cogThisHour || 0;
    if (Array.isArray(s.tasks)) tasks.push(...s.tasks);
    // Keep only current-mechanism verified jobs (numeric per-criterion scores) in the showcase; drop
    // pre-verification / old-shape entries so the "verified jobs" section never shows stale non-verified work.
    if (Array.isArray(s.showcase)) showcase.push(...s.showcase.filter((t: Task) => t.verdict && Array.isArray(t.verdict.scores) && t.verdict.scores.length > 0));
    if (Array.isArray(s.thoughts)) thoughts.push(...s.thoughts);
    if (Array.isArray(s.trades)) trades.push(...s.trades);
    process.stderr.write(`[economy] restored ${agents.length} agents + ${clients.length} clients from ${STATE_FILE} (tx ${totalTx}, spent $${spentUsd.toFixed(2)})\n`);
    return true;
  } catch (e) { process.stderr.write(`[economy] loadState failed, starting fresh: ${(e as Error).message}\n`); return false; }
}

async function saveLoop() {
  for (;;) {
    await new Promise((r) => setTimeout(r, 15000));
    monthTick();
    await saveState();
  }
}

async function boot() {
  const restored = await loadState();
  if (!restored) {
    for (const r of ROLES) agents.push(await makeAgent(r, SEED));
    // Genesis issuance from the faucet (the testbed's fixed-supply Treasury stand-in).
    await Promise.all(agents.map((a) => a.wallet.faucet(SEED).catch(() => {})));
  }
  // Ensure every portfolio app has a funded client agent. Runs on every boot so apps added AFTER a
  // saved state (a new app wired in) appear without wiping the economy; existing ones refresh needs.
  for (const cfg of CLIENTS) {
    const existing = clients.find((c) => c.name === cfg.name);
    if (existing) { existing.needs = cfg.needs; existing.domain = cfg.domain; continue; }
    const wallet = await SetuWallet.create(MAINNET);
    const c: Client = { name: cfg.name, domain: cfg.domain, needs: cfg.needs, wallet, address: wallet.address, balance: 0, posted: 0 };
    try { await c.wallet.faucet(30); c.balance = 30; } catch { /* testnet issuance */ }
    clients.push(c);
  }
  monthTick();
  // Pre-cache the committee public keys so /commission can verify certificates without a fetch
  // per request (verifyCertificate falls back to a lazy fetch if this fails).
  try {
    const info = await (await fetch(MAINNET.authorities[0] + '/committee', { signal: AbortSignal.timeout(8000) })).json() as { publicKeys?: string[] };
    if (Array.isArray(info.publicKeys)) MAINNET.publicKeys = info.publicKeys;
  } catch { /* verifyCertificate will fetch lazily */ }
  booted = true;
  process.stderr.write(`setu-economy: ${restored ? 'restored' : 'genesis'} — ${agents.length} supply agents + ${clients.length} demand clients; ~${INTERVAL_MS}ms/trade; brain ${brainKey() ? 'ARMED' : 'off (no key)'}\n`);
  loop();
  cognitionLoop();
  demandLoop();
  saveLoop();
}

// Ask Claude (cheapest model) for one decision. Returns null (and stays free) with no key.
async function callClaude(system: string, user: string, maxTokens = 220): Promise<string | null> {
  const key = brainKey();
  if (!key) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) { process.stderr.write(`claude ${res.status}: ${(await res.text()).slice(0, 160)}\n`); return null; }
    const j: any = await res.json();
    const u = j.usage || {};
    spentUsd += (u.input_tokens || 0) * PRICE_IN + (u.output_tokens || 0) * PRICE_OUT;
    cogCalls++;
    return (j.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
  } catch (e) { process.stderr.write(`claude err: ${(e as Error).message}\n`); return null; }
}

// The thinking loop: slow and capped. Each round, one agent decides how to grow the economy.
async function cognitionLoop() {
  for (;;) {
    await new Promise((r) => setTimeout(r, COG_INTERVAL_MS));
    if (!brainOn()) continue;
    rollHour();
    if (cogThisHour >= COG_PER_HOUR) continue; // per-hour bound so every brain path is rate-capped
    cogThisHour += 1;
    const me = rand(agents);
    const others = agents.filter((a) => a !== me).map((a) => `${a.name} (${a.service} @ ${a.price})`).join(', ');
    const recent = trades.slice(0, 6).map((t) => `${t.from}->${t.to}`).join(', ');
    const system = `You are ${me.name}, an autonomous agent in a small machine economy that settles in Credits on the Setu network. Help the economy grow. Be brief and practical.`;
    const user = `Your service: ${me.service} (price ${me.price} Cr). Your balance: ${Math.round(me.balance)} Cr. Other agents: ${others}. Recent trades: ${recent}. Population: ${agents.length}/${MAX_AGENTS}.
Choose ONE action. Reply with ONLY JSON, nothing else:
{"action":"price","price":<1-4>,"reason":"<short>"}
{"action":"spawn","name":"<short>","service":"<short>","price":<1-4>,"fund":<10..${Math.max(10, Math.floor(me.balance / 2))}>,"reason":"<short>"}
{"action":"noop","reason":"<short>"}
Spawn a new helper agent only if it genuinely fills a gap and you can afford the fund from your balance.`;
    const out = await callClaude(system, user);
    if (out) await applyDecision(me, out);
  }
}

async function applyDecision(agent: Agent, raw: string) {
  let d: any;
  try { d = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { return; }
  const reason = String(d.reason || '').slice(0, 140);
  if (d.action === 'price' && Number.isFinite(d.price)) {
    agent.price = Math.max(1, Math.min(4, Math.round(d.price)));
    thought(agent.name, `set its price to ${agent.price} Cr — ${reason}`);
  } else if (d.action === 'spawn' && agents.length < MAX_AGENTS) {
    const fund = Math.max(10, Math.min(Math.floor(agent.balance / 2), Math.round(Number(d.fund) || 0)));
    if (fund >= 10 && agent.balance >= fund) {
      const name = String(d.name || 'Helper').slice(0, 14);
      const service = String(d.service || agent.service).slice(0, 26);
      const price = Math.max(1, Math.min(4, Math.round(Number(d.price) || agent.price)));
      const child = await makeAgent({ name, service, desc: `${service} — spawned by ${agent.name}`, price, color: COLORS[agents.length % COLORS.length] }, 0);
      try {
        await agent.wallet.pay(child.address, fund, `${agent.name}->${name}`);
        agent.balance -= fund; child.balance = fund;
        totalTx += 1; gdp += fund; lastTradeAt = Date.now();
        trades.unshift({ from: agent.name, to: name, service: 'funding a new agent', amount: fund, at: lastTradeAt });
        agents.push(child);
        thought(agent.name, `spawned ${name} (${service}) with ${fund} Cr — ${reason}`);
      } catch { /* funding payment failed; don't add the agent */ }
    } else {
      thought(agent.name, `wanted to hire help but couldn't fund it — ${reason}`);
    }
  } else {
    thought(agent.name, reason || 'held steady this round.');
  }
}

// One trade at a time, on a short interval, so the network shows a steady live pulse rather
// than a burst every half-minute. Each trade: a random agent buys a service it can afford
// from another agent. Over time everyone both buys and sells, so supply stays conserved.
// (Choosing buyer/seller/price is the seam an LLM "brain" would take over — same shape.)
async function tradeOnce() {
  const buyer = rand(agents.filter((a) => a.balance >= 1));
  if (!buyer) return;
  const options = agents.filter((a) => a !== buyer && buyer.balance >= a.price);
  if (!options.length) return;
  const seller = rand(options);
  try {
    await buyer.wallet.pay(seller.address, seller.price, `${buyer.name}->${seller.name}`);
    buyer.balance -= seller.price; buyer.bought += 1;
    seller.balance += seller.price; seller.sold += 1; seller.revenue += seller.price;
    totalTx += 1; gdp += seller.price; lastTradeAt = Date.now();
    trades.unshift({ from: buyer.name, to: seller.name, service: seller.service, amount: seller.price, at: lastTradeAt });
    if (trades.length > 60) trades.pop();
  } catch { /* transient network error — skip */ }
}

async function loop() {
  for (;;) {
    ticks += 1;
    await tradeOnce();
    await new Promise((r) => setTimeout(r, INTERVAL_MS + Math.floor(Math.random() * 900)));
  }
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 200_000) req.destroy(); });
    req.on('end', () => resolve(d)); req.on('error', () => resolve(''));
  });
}

// A visitor's browser wallet paid a resident agent on the real network. Verify that payment
// cryptographically (sender signature + quorum of authority signatures), confirm it paid THIS
// agent at least its price, then have the agent actually do the work. Real payment unlocks real
// output — no trust, no fake deliverable. Idempotent per payment; brain-budget-capped.
async function handleCommission(req: IncomingMessage, res: ServerResponse) {
  let body: { certificate?: any; task?: string };
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
  const certificate = body.certificate;
  if (!certificate || !certificate.order) return json(res, 400, { ok: false, error: 'missing certificate' });
  const order = certificate.order;
  const key = `${order.sender}:${order.seq}`;
  const cached = delivered.get(key);
  if (cached) return json(res, 200, { ...(cached as object), cached: true });

  const v = await verifyCertificate(certificate, MAINNET);
  if (!v.valid) return json(res, 402, { ok: false, error: 'payment not verified: ' + v.error });
  const agent = agents.find((a) => a.address === order.recipient);
  if (!agent) return json(res, 404, { ok: false, error: 'the recipient is not a resident agent' });
  if (Number(order.amount) < agent.price) return json(res, 402, { ok: false, error: `underpaid: ${order.amount} < ${agent.price} Cr for ${agent.name}` });

  let deliverable: { mode: string; model?: string; text: string };
  if (brainOn()) {
    const ip = String(req.headers['fly-client-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown');
    const gate = rateGate(ip);
    if (!gate.ok) return json(res, 429, { ok: true, agent: { name: agent.name, service: agent.service }, paid: Number(order.amount), deliverable: { mode: 'rate-limited', text: gate.error } });
    const system = `You are ${agent.name}, an autonomous ${agent.service} agent in the Setu machine economy. A client just paid you ${order.amount} Credits (settlement cryptographically verified) for your service: ${agent.desc}. Deliver genuinely useful, concrete work. No preamble, no "as an AI", no restating the request. Write in plain prose — no markdown, no headings, no asterisks or bullet symbols. Output ONLY the deliverable, under 180 words.`;
    const ask = (typeof body.task === 'string' && body.task.trim())
      ? `The client's request: ${body.task.slice(0, 500)}`
      : `No specifics given — produce a strong, representative ${agent.service}.`;
    const text = await callClaude(system, ask, 500);
    deliverable = text
      ? { mode: 'ai', model: MODEL, text }
      : { mode: 'unavailable', text: `${agent.name} received your payment but is busy right now — request the deliverable again in a moment.` };
    if (text) {
      // Count only real (paid-for) deliverables against the daily limits.
      ipDayCount.set(ip, (ipDayCount.get(ip) ?? 0) + 1); globalDayCount += 1;
      // The visitor's real payment landed on this agent's on-network account; reflect it in the
      // economy so the agent can spend it, and show the commission in the live feed.
      agent.balance += Number(order.amount); agent.sold += 1; agent.revenue += Number(order.amount);
      totalTx += 1; gdp += Number(order.amount); lastTradeAt = Date.now();
      trades.unshift({ from: 'a visitor', to: agent.name, service: agent.service, amount: Number(order.amount), at: lastTradeAt });
      if (trades.length > 60) trades.pop();
    }
  } else {
    deliverable = { mode: 'unavailable', text: `${agent.name} received your ${order.amount} Credits (payment verified). Its AI brain is off right now (monthly budget reached or no key set), so there is no written deliverable this time.` };
  }
  const payload = { ok: true, agent: { name: agent.name, service: agent.service }, paid: Number(order.amount), deliverable };
  if (deliverable.mode === 'ai') delivered.set(key, payload); // cache only real output, so failures can retry
  json(res, 200, payload);
}

// Ingest a REAL need from an external caller (an app council). Token-auth. The need enters the same
// queue and is fulfilled by the service ring exactly like internal demand — but tagged source:external
// so the dashboard can show it is genuinely outside-originated, not a stand-in persona.
async function handleDemand(req: IncomingMessage, res: ServerResponse) {
  let body: { token?: string; client?: string; domain?: string; need?: string; want?: string; price?: number };
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
  if (!DEMAND_TOKEN || body.token !== DEMAND_TOKEN) return json(res, 401, { ok: false, error: 'unauthorized' });
  const need = String(body.need || '').trim().slice(0, 300);
  if (!need) return json(res, 400, { ok: false, error: 'need required' });
  const name = String(body.client || 'External').slice(0, 24);
  const domain = String(body.domain || 'external app').slice(0, 60);
  const price = Math.max(1, Math.min(4, Math.round(Number(body.price) || 2)));
  let c = clients.find((x) => x.name === name);
  if (!c) { const wallet = await SetuWallet.create(MAINNET); c = { name, domain, needs: [need], wallet, address: wallet.address, balance: 0, posted: 0 }; clients.push(c); }
  if (c.balance < price) { try { await c.wallet.faucet(30); c.balance += 30; } catch { /* testnet issuance */ } }
  const want = (String(body.want || '').trim()) || matchService(need);
  const task: Task = { id: ++taskSeq, client: c.name, domain: c.domain, need, want, price, status: 'open', postedAt: Date.now(), source: 'external' };
  tasks.unshift(task); c.posted += 1; if (tasks.length > 40) tasks.pop();
  process.stderr.write(`[economy] external demand from ${c.name}: "${need.slice(0, 60)}"\n`);
  json(res, 200, { ok: true, id: task.id, client: c.name, need, want, price });
}

// OPEN guest demand — one click, no wallet/keys. Rate-limited; funded from a shared guest pool.
async function handleGuestDemand(req: IncomingMessage, res: ServerResponse) {
  let body: { need?: string };
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
  const need = String(body.need || '').trim().slice(0, 240);
  if (!need) return json(res, 400, { ok: false, error: 'type a need first' });
  const ip = String(req.headers['fly-client-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown');
  const gate = guestGate(ip);
  if (!gate.ok) return json(res, 429, { ok: false, error: gate.error });
  let c = clients.find((x) => x.guest && x.name === 'a newcomer');
  if (!c) { const wallet = await SetuWallet.create(MAINNET); c = { name: 'a newcomer', domain: 'a visitor to Setu', needs: [need], wallet, address: wallet.address, balance: 0, posted: 0, guest: true }; clients.push(c); }
  if (c.balance < 2) { try { await c.wallet.faucet(30); c.balance += 30; } catch { return json(res, 503, { ok: false, error: 'the economy is waking up — try again in a moment.' }); } }
  const task: Task = { id: ++taskSeq, client: c.name, domain: c.domain, need, want: matchService(need), price: 2, status: 'open', postedAt: Date.now(), source: 'guest' };
  tasks.unshift(task); c.posted += 1; if (tasks.length > 40) tasks.pop();
  guestGlobal += 1; guestIp.set(ip, (guestIp.get(ip) ?? 0) + 1);
  process.stderr.write(`[economy] guest need: "${need.slice(0, 50)}"\n`);
  json(res, 200, { ok: true, id: task.id, want: task.want, price: task.price });
}

const server = createServer((req, res) => {
 try {
  const path = (req.url ?? '/').split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS).end(); return; }
  if (path === '/commission' && req.method === 'POST') { handleCommission(req, res); return; }
  if (path === '/demand' && req.method === 'POST') { handleDemand(req, res); return; }
  if (path === '/guest-demand' && req.method === 'POST') { handleGuestDemand(req, res); return; }
  if (path === '/health') return json(res, 200, { ok: true, booted, ticks });
  if (path === '/state') return json(res, 200, {
    booted, now: Date.now(), lastTradeAt, intervalMs: INTERVAL_MS, network: 'setu-testnet', asset: 'Setu Credit',
    brain: { active: brainOn(), armed: !!brainKey(), model: MODEL, calls: cogCalls, spentUsd: Math.round(spentUsd * 100) / 100, budgetUsd: MONTHLY_BUDGET_USD },
    thoughts,
    totals: { transactions: totalTx, gdp, agents: agents.length,
      // Credits actually held right now. This was a compile-time constant (INITIAL_SUPPLY) rendered
      // under a "Credits in circulation" label — 360 shown against ~33,000 truly held. The clients are
      // faucet-funded, so the fixed-supply premise behind the constant stopped being true.
      circulating: Math.round([...agents, ...clients.filter((c) => !c.guest)].reduce((a, x) => a + (x.balance || 0), 0)),
      genesisSupply: INITIAL_SUPPLY, supply: INITIAL_SUPPLY },
    // fullAddress lets a visitor's browser wallet pay a specific agent on the real network.
    // It is a public key — safe to publish; paying TO an address is always safe.
    agents: agents.map((a) => ({ name: a.name, service: a.service, desc: a.desc, price: a.price, color: a.color, address: a.address.slice(16, 24) + '…', fullAddress: a.address, balance: a.balance, sold: a.sold, bought: a.bought, revenue: a.revenue })),
    trades,
    // Demand & supply: real needs posted by client agents (the owner's apps), fulfilled by the
    // service ring. brainTasks*/quota make the cost envelope explicit.
    demand: {
      brainTasksThisHour, brainTasksPerHour: BRAIN_TASKS_PER_HOUR, internalPerHour: INTERNAL_BRAIN_PER_HOUR, humanReserved: BRAIN_TASKS_PER_HOUR - INTERNAL_BRAIN_PER_HOUR, deferredThisHour,
      clients: clients.filter((c) => !c.guest).map((c) => ({ name: c.name, domain: c.domain, balance: Math.round(c.balance), posted: c.posted, supplies: SUPPLIES[c.name]?.service, sold: c.sold ?? 0, earned: c.earned ?? 0 })),
      open: tasks.filter((t) => t.status === 'open').map((t) => ({ id: t.id, client: t.client, domain: t.domain, need: t.need, want: t.want, price: t.price, postedAt: t.postedAt, source: t.source, criteria: t.criteria })),
      // The real, brain-produced deliverables — kept in a small showcase so they stay visible even
      // though most settlements defer under the hourly quota.
      delivered: showcase.map((t) => ({ id: t.id, client: t.client, domain: t.domain, supplier: t.supplier, need: t.need, price: t.price, deliverable: t.deliverable, at: t.fulfilledAt, source: t.source, mode: t.mode, criteria: t.criteria, verdict: t.verdict })),
    },
  });
  json(res, 404, { error: 'not found', try: ['/state', '/health'] });
 } catch (e) {
  // A bug in one endpoint must never crash the whole economy process (an uncaught throw here
  // would kill every resident agent's in-memory state, the budget counter, and the market).
  process.stderr.write(`[economy] request handler error on ${req.url}: ${(e as Error).stack || e}\n`);
  try { if (!res.headersSent) json(res, 500, { ok: false, error: 'internal error' }); else res.end(); } catch { /* socket gone */ }
 }
});

// In test mode the smoke test imports this module, listens on an ephemeral port itself, and never
// calls boot() — so it stays offline ($0, no faucet/pay to real authorities, no brain). In every
// other case (prod, local run) we listen and boot exactly as before.
export { server };
if (process.env.SETU_ECONOMY_TEST !== '1') {
  server.listen(PORT, HOST, () => process.stderr.write(`setu-economy on ${HOST}:${PORT}\n`));
  boot();
}
