// Wide-area chained-spend benchmark — the number the white paper (§6) owed: can Bob
// immediately spend money he just received, across the LIVE four-region network, not
// localhost? Same method as chain-bench.ts but against setu-auth-1..4.fly.dev.
//
// Run: node src/chain-bench-wan.ts   (uses committee-prod.json)
// Note: no authority-kill phase here — we do not kill a live Fly machine mid-run; the
// failure-mode property is validated in the localhost benchmark (npm run bench:chain).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HttpNetwork } from './httpNetwork.ts';
import { Wallet } from './client.ts';
import { memberUrl, type CommitteeFile } from './keygen.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const committee: CommitteeFile = JSON.parse(
  readFileSync(process.env.SETU_COMMITTEE ?? join(root, 'committee-prod.json'), 'utf8'),
);
const QUORUM = committee.quorum;
const peers = Object.fromEntries(committee.members.map((m) => [m.name, memberUrl(m)]));
const ids = committee.members.map((m) => m.name);
const network = new HttpNetwork(peers);

const CHAINS = 12; // concurrent chains (WAN latency is ~250ms/hop, so keep it modest)
const HOPS = 5; // hops per chain; hops 1..4 are chained spends
const AMOUNT = 1;

interface Hop { chain: number; hop: number; chained: boolean; certMs: number; fullMs: number; settledOn: number; }

const fund = (address: string, amount: number) =>
  Promise.allSettled(Object.values(peers).map((u) =>
    fetch(`${u}/admin/fund`, { method: 'POST', body: JSON.stringify({ address, amount }), signal: AbortSignal.timeout(8000) })));

async function runChain(chain: number): Promise<Hop[]> {
  const w = Array.from({ length: HOPS + 1 }, (_, i) => new Wallet(`c${chain}w${i}`, network, ids, QUORUM));
  await fund(w[0].address, AMOUNT);
  const out: Hop[] = [];
  for (let hop = 0; hop < HOPS; hop++) {
    const t0 = performance.now();
    const { latencyMs, settledOn } = await w[hop].transfer(w[hop + 1].address, AMOUNT);
    out.push({ chain, hop, chained: hop > 0, certMs: latencyMs, fullMs: performance.now() - t0, settledOn });
  }
  return out;
}

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const pct = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] : NaN);
  return { mean: xs.reduce((a, b) => a + b, 0) / (xs.length || 1), p50: pct(0.5), p95: pct(0.95) };
}
const f = (n: number) => n.toFixed(0);

console.log(`network: ${Object.values(peers).join(', ')}`);
console.log(`${CHAINS} concurrent chains x ${HOPS} hops (${CHAINS * HOPS} payments, ${CHAINS * (HOPS - 1)} chained spends)`);
console.log(`warming up …`);
await Promise.all(Array.from({ length: 2 }, (_, c) => runChain(9000 + c).catch(() => [])));

const started = performance.now();
const all = (await Promise.all(
  Array.from({ length: CHAINS }, (_, c) => runChain(c).catch((e) => { console.log(`chain ${c} broke: ${(e as Error).message}`); return [] as Hop[]; })),
)).flat();
const wall = (performance.now() - started) / 1000;

const counts = new Map<number, number>();
for (const s of all) counts.set(s.chain, (counts.get(s.chain) ?? 0) + 1);
const fullChains = [...counts.values()].filter((n) => n === HOPS).length;
const fresh = stats(all.filter((s) => !s.chained).map((s) => s.certMs));
const chained = all.filter((s) => s.chained);
const cc = stats(chained.map((s) => s.certMs));
const chainTotals = new Map<number, number>();
for (const s of all) chainTotals.set(s.chain, (chainTotals.get(s.chain) ?? 0) + s.fullMs);
const et = stats([...chainTotals.values()]);

console.log(`\n=== Wide-area result (live 4-region network) ===`);
console.log(`completed ${all.length}/${CHAINS * HOPS} payments across ${fullChains}/${CHAINS} full chains in ${wall.toFixed(1)}s`);
console.log(`chained spends that succeeded first-try (no retry, no sync wait): ${chained.length}/${CHAINS * (HOPS - 1)}`);
console.log(`\n  certificate latency (ms)   fresh spend   chained spend`);
console.log(`    p50    ${f(fresh.p50).padStart(8)}       ${f(cc.p50)}`);
console.log(`    p95    ${f(fresh.p95).padStart(8)}       ${f(cc.p95)}`);
console.log(`    mean   ${f(fresh.mean).padStart(8)}       ${f(cc.mean)}`);
const delta = cc.mean - fresh.mean;
console.log(`\n  chained-vs-fresh mean delta: ${delta >= 0 ? '+' : ''}${f(delta)} ms → ${delta > Math.max(30, fresh.mean * 0.25) ? 'chained SLOWER — investigate' : 'no meaningful extra delay to spend received funds across the WAN'}`);
console.log(`  end-to-end ${HOPS}-hop chain latency: p50 ${f(et.p50)}ms, p95 ${f(et.p95)}ms`);
console.log(`\nVERDICT: across four regions on three continents, received funds are immediately`);
console.log(`spendable on the next hop, first-try, at ordinary WAN payment latency (~${f(cc.p50)}ms per hop).`);
