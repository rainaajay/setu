// A "wild agent" pays for a web resource it has never seen, using only the x402 flow and
// the Setu SDK. Spawns the gateway locally (which settles on the LIVE Setu network) and
// runs the full loop: discover → GET → 402 → pay on Setu → retry → 200.
// Run: node packages/setu-gateway/demo.ts
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SetuWallet } from '../setu-pay/index.ts';

// Target a live gateway with GATEWAY_URL=..., otherwise spawn one locally.
const dir = dirname(fileURLToPath(import.meta.url));
const PORT = 7400;
const LIVE = process.env.GATEWAY_URL;
const BASE = LIVE ?? `http://127.0.0.1:${PORT}`;
const gw = LIVE ? null : spawn(process.execPath, [join(dir, 'gateway.ts')], {
  stdio: 'inherit', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
});

const b64 = (s: string) => Buffer.from(s).toString('base64');
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(300) })).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('gateway did not start');
}

try {
  await waitUp();

  console.log('1. DISCOVER — read the agent card');
  const card = await (await fetch(`${BASE}/.well-known/agent-card.json`)).json();
  console.log(`   found "${card.name}": ${card.skills[0].name} @ ${card.skills[0].price.amount} ${card.skills[0].price.asset}`);
  console.log(`   pays via ${card.payments.protocol}/${card.payments.scheme}\n`);

  console.log('2. REQUEST without paying → expect 402');
  const challenge = await fetch(`${BASE}/premium-quote`);
  const body = await challenge.json();
  console.log(`   HTTP ${challenge.status}; accepts scheme "${body.accepts[0].scheme}", pay ${body.accepts[0].maxAmountRequired} to ${body.accepts[0].payTo.slice(16, 24)}…`);
  const { payTo, extra, maxAmountRequired } = body.accepts[0];

  console.log('\n3. PAY on Setu (the agent funds a fresh wallet and pays the invoice)');
  const agent = await SetuWallet.create();
  await agent.faucet(10);
  const receipt = await agent.pay(payTo, Number(maxAmountRequired), extra.invoiceId);
  console.log(`   paid ${maxAmountRequired} — FINAL in ${receipt.latencyMs.toFixed(0)}ms, settled on ${receipt.settledOn}/4`);

  console.log('\n4. RETRY with proof of payment → expect 200 + the resource');
  const paid = await fetch(`${BASE}/premium-quote`, {
    headers: { 'x-payment': b64(JSON.stringify({ scheme: 'setu', invoiceId: extra.invoiceId, certificate: receipt.certificate })) },
  });
  const data = await paid.json();
  console.log(`   HTTP ${paid.status}:`, JSON.stringify(data));

  console.log('\n5. REPLAY the same payment → expect refusal (single-use)');
  const replay = await fetch(`${BASE}/premium-quote`, {
    headers: { 'x-payment': b64(JSON.stringify({ scheme: 'setu', invoiceId: extra.invoiceId, certificate: receipt.certificate })) },
  });
  console.log(`   HTTP ${replay.status}: ${(await replay.json()).error}`);

  console.log('\nA stranger agent discovered, paid for, and consumed a web resource over Setu — no account, no API key.');
} finally {
  gw?.kill();
}
