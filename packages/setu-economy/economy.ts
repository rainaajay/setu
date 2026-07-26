// Setu resident economy — a small, always-on population of agents that pay each other for
// real micro-services in Credits on the LIVE Setu network. A newcomer arrives into a living
// market, not an empty one. Policies are rule-based today; an LLM "brain" is a drop-in
// (see decide() below). Zero dependencies; wraps setu-pay.
//
// Runs as a service: a market loop every TICK_MS, plus GET /state, /health (CORS) for the
// public dashboard. Deploy target: Fly (setu-economy). Test units == Setu Credits.
import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
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
const INITIAL_SUPPLY = ROLES.length * SEED; // fixed; spawns move existing Credits, don't mint
const thoughts: { agent: string; text: string; at: number }[] = [];
let spentUsd = 0, cogCalls = 0;
// One paid commission -> one deliverable. Keyed by sender:seq so re-requesting the same payment
// returns the same work and never double-charges the AI budget.
const delivered = new Map<string, unknown>();

// Abuse guard for the paid deliverable path. The faucet is open, so without this one actor could
// mint test Credits and burn the shared AI budget. The $/month cap (brainOn) is the absolute
// backstop; these daily limits stop a single source monopolising it. Env-tunable.
const COMMISSIONS_PER_IP_DAY = Number(process.env.COMMISSIONS_PER_IP_DAY ?? 15);
const COMMISSIONS_GLOBAL_DAY = Number(process.env.COMMISSIONS_GLOBAL_DAY ?? 300);
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

async function boot() {
  for (const r of ROLES) agents.push(await makeAgent(r, SEED));
  // Genesis issuance from the faucet (the testbed's fixed-supply Treasury stand-in).
  await Promise.all(agents.map((a) => a.wallet.faucet(SEED).catch(() => {})));
  // Pre-cache the committee public keys so /commission can verify certificates without a fetch
  // per request (verifyCertificate falls back to a lazy fetch if this fails).
  try {
    const info = await (await fetch(MAINNET.authorities[0] + '/committee', { signal: AbortSignal.timeout(8000) })).json() as { publicKeys?: string[] };
    if (Array.isArray(info.publicKeys)) MAINNET.publicKeys = info.publicKeys;
  } catch { /* verifyCertificate will fetch lazily */ }
  booted = true;
  process.stderr.write(`setu-economy: ${agents.length} agents funded ${SEED} each; ~${INTERVAL_MS}ms/trade; brain ${brainKey() ? 'ARMED' : 'off (no key)'}\n`);
  loop();
  cognitionLoop();
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

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS).end(); return; }
  if (path === '/commission' && req.method === 'POST') { handleCommission(req, res); return; }
  if (path === '/health') return json(res, 200, { ok: true, booted, ticks });
  if (path === '/state') return json(res, 200, {
    booted, now: Date.now(), lastTradeAt, intervalMs: INTERVAL_MS, network: 'setu-testnet', asset: 'Setu Credit',
    brain: { active: brainOn(), armed: !!brainKey(), model: MODEL, calls: cogCalls, spentUsd: Math.round(spentUsd * 100) / 100, budgetUsd: MONTHLY_BUDGET_USD },
    thoughts,
    totals: { transactions: totalTx, gdp, agents: agents.length, supply: INITIAL_SUPPLY },
    // fullAddress lets a visitor's browser wallet pay a specific agent on the real network.
    // It is a public key — safe to publish; paying TO an address is always safe.
    agents: agents.map((a) => ({ name: a.name, service: a.service, desc: a.desc, price: a.price, color: a.color, address: a.address.slice(16, 24) + '…', fullAddress: a.address, balance: a.balance, sold: a.sold, bought: a.bought, revenue: a.revenue })),
    trades,
  });
  json(res, 404, { error: 'not found', try: ['/state', '/health'] });
});

server.listen(PORT, HOST, () => process.stderr.write(`setu-economy on ${HOST}:${PORT}\n`));
boot();
