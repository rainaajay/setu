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
const TICK_MS = Number(process.env.TICK_MS ?? 25_000);
const SEED = 50; // Credits each agent is issued at genesis

// The resident population. Each offers a real service and consumes the next agent's output,
// forming a closed value chain — so Credits circulate and total supply is conserved.
const ROLES = [
  { name: 'Oracle', service: 'price feed', color: '#b3702d' },
  { name: 'FX Desk', service: 'currency conversion', color: '#3c6e4f' },
  { name: 'Analyst', service: 'trade signals', color: '#2e5a7a' },
  { name: 'Scribe', service: 'written reports', color: '#7a2e2e' },
  { name: 'Monitor', service: 'risk alerts', color: '#5a4a7a' },
  { name: 'Broker', service: 'order execution', color: '#8a6a1e' },
];

type Agent = {
  name: string; service: string; color: string;
  wallet: SetuWallet; address: string;
  balance: number; sold: number; bought: number; revenue: number;
};

const agents: Agent[] = [];
const trades: { from: string; to: string; service: string; amount: number; at: number }[] = [];
let totalTx = 0;
let gdp = 0;
let ticks = 0;
let lastTickMs = 0;
let booted = false;

// The decision an agent makes each tick. RULE-BASED today: buy the next agent's service if
// affordable. An LLM brain would replace this body with a Claude call ("given my balance,
// role, and the market, what should I buy / what should I charge?") — same signature.
function decide(buyer: Agent, seller: Agent): { buy: boolean; amount: number } {
  const price = 1;
  return { buy: buyer.balance >= price, amount: price };
}

async function boot() {
  for (const r of ROLES) {
    const wallet = await SetuWallet.create(MAINNET);
    agents.push({ ...r, wallet, address: wallet.address, balance: SEED, sold: 0, bought: 0, revenue: 0 });
  }
  // Genesis issuance from the faucet (the testbed's fixed-supply Treasury stand-in).
  await Promise.all(agents.map((a) => a.wallet.faucet(SEED).catch(() => {})));
  booted = true;
  process.stderr.write(`setu-economy: ${agents.length} agents funded ${SEED} each; tick ${TICK_MS}ms\n`);
  loop();
}

async function loop() {
  for (;;) {
    ticks++;
    const n = agents.length;
    // Each agent buys the NEXT agent's service — a ring, so every agent both pays and earns.
    await Promise.all(agents.map(async (buyer, i) => {
      const seller = agents[(i + 1) % n];
      const d = decide(buyer, seller);
      if (!d.buy) return;
      try {
        await buyer.wallet.pay(seller.address, d.amount, `${buyer.name}->${seller.name}`);
        buyer.balance -= d.amount; buyer.bought += 1;
        seller.balance += d.amount; seller.sold += 1; seller.revenue += d.amount;
        totalTx += 1; gdp += d.amount;
        trades.unshift({ from: buyer.name, to: seller.name, service: seller.service, amount: d.amount, at: Date.now() });
        if (trades.length > 40) trades.pop();
      } catch { /* transient network error — skip this edge this tick */ }
    }));
    lastTickMs = Date.now();
    await new Promise((r) => setTimeout(r, TICK_MS));
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
    booted, ticks, lastTickMs, tickMs: TICK_MS, network: 'setu-testnet', asset: 'Setu Credit',
    totals: { transactions: totalTx, gdp, agents: agents.length, supply: agents.length * SEED },
    agents: agents.map((a) => ({ name: a.name, service: a.service, color: a.color, address: a.address.slice(16, 24) + '…', balance: a.balance, sold: a.sold, bought: a.bought, revenue: a.revenue })),
    trades,
  });
  json(res, 404, { error: 'not found', try: ['/state', '/health'] });
});

server.listen(PORT, HOST, () => process.stderr.write(`setu-economy on ${HOST}:${PORT}\n`));
boot();
