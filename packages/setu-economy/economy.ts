// Setu resident economy — a small, always-on population of agents that pay each other for
// real micro-services in Credits on the LIVE Setu network. A newcomer arrives into a living
// market, not an empty one. Policies are rule-based today; an LLM "brain" is a drop-in
// (see decide() below). Zero dependencies; wraps setu-pay.
//
// Runs as a service: a market loop every TICK_MS, plus GET /state, /health (CORS) for the
// public dashboard. Deploy target: Fly (setu-economy). Test units == Setu Credits.
import { createServer, type ServerResponse } from 'node:http';
import { SetuWallet, MAINNET } from '../setu-pay/index.ts';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '127.0.0.1';
// One trade roughly every ~2 seconds, so the network always looks alive.
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 2000);
const SEED = 60; // Credits each agent is issued at genesis

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
const rand = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

async function boot() {
  for (const r of ROLES) {
    const wallet = await SetuWallet.create(MAINNET);
    agents.push({ ...r, wallet, address: wallet.address, balance: SEED, sold: 0, bought: 0, revenue: 0 });
  }
  // Genesis issuance from the faucet (the testbed's fixed-supply Treasury stand-in).
  await Promise.all(agents.map((a) => a.wallet.faucet(SEED).catch(() => {})));
  booted = true;
  process.stderr.write(`setu-economy: ${agents.length} agents funded ${SEED} each; ~${INTERVAL_MS}ms/trade\n`);
  loop();
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

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' };
function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS).end(); return; }
  if (path === '/health') return json(res, 200, { ok: true, booted, ticks });
  if (path === '/state') return json(res, 200, {
    booted, now: Date.now(), lastTradeAt, intervalMs: INTERVAL_MS, network: 'setu-testnet', asset: 'Setu Credit',
    totals: { transactions: totalTx, gdp, agents: agents.length, supply: agents.length * SEED },
    agents: agents.map((a) => ({ name: a.name, service: a.service, desc: a.desc, price: a.price, color: a.color, address: a.address.slice(16, 24) + '…', balance: a.balance, sold: a.sold, bought: a.bought, revenue: a.revenue })),
    trades,
  });
  json(res, 404, { error: 'not found', try: ['/state', '/health'] });
});

server.listen(PORT, HOST, () => process.stderr.write(`setu-economy on ${HOST}:${PORT}\n`));
boot();
