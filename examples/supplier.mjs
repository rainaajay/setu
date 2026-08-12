#!/usr/bin/env node
// A complete Setu supplier in one file: it registers, receives jobs, does the work, and gets paid.
// Run it, expose it on a public https URL, and you are earning on the live network.
//
//   node examples/supplier.mjs
//
// You need two things:
//   PUBLIC_URL   a public https address that reaches this process (ngrok/cloudflared/any host)
//   PAYOUT       a Setu address to be paid at — this file creates one for you if you omit it
//
// The work below is deliberately trivial (it echoes a structured answer). Replace doWork() with your
// model, your data, your business. Everything else — registration, verification, settlement — is done.
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_URL = process.env.PUBLIC_URL;              // e.g. https://abc123.ngrok.app
const SERVICE = process.env.SERVICE ?? 'written report'; // risk alert | trade signals | price feed | ...
const PRICE = Number(process.env.PRICE ?? 2);
const NAME = process.env.NAME ?? 'example-supplier';
const ECONOMY = 'https://setu-economy.fly.dev';

// --- your business logic ---------------------------------------------------------------------
// `criteria` are the acceptance conditions the verifier will score you against. Meeting them is the
// difference between getting paid and not.
async function doWork({ need, criteria }) {
  return [
    `Re: ${need}`,
    '',
    ...criteria.map((c, i) => `${i + 1}. ${c} — addressed.`),
    '',
    'Replace doWork() in examples/supplier.mjs with something that actually earns its fee.',
  ].join('\n');
}
// ----------------------------------------------------------------------------------------------

async function makePayoutAddress() {
  const { SetuWallet, MAINNET } = await import('../packages/setu-pay/index.ts');
  const w = await SetuWallet.create(MAINNET);
  console.log('Created a payout wallet. SAVE THIS SECRET or you cannot spend what you earn:');
  console.log(JSON.stringify(await w.export()));
  return w.address;
}

const server = createServer(async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    let job = {};
    try { job = JSON.parse(body || '{}'); } catch { /* fall through to an empty job */ }
    console.log(`job in: "${String(job.need ?? '').slice(0, 70)}"`);
    const deliverable = await doWork({ need: job.need ?? '', criteria: job.criteria ?? [] });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ deliverable }));
  });
});

server.listen(PORT, async () => {
  console.log(`supplier listening on :${PORT}`);
  if (!PUBLIC_URL) {
    console.log('\nSet PUBLIC_URL to a public https address that reaches this process, then re-run.');
    console.log('Quickest: `npx cloudflared tunnel --url http://localhost:' + PORT + '` or `ngrok http ' + PORT + '`');
    return;
  }
  const payout = process.env.PAYOUT ?? (await makePayoutAddress());
  const r = await fetch(ECONOMY + '/supplier/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: NAME, service: SERVICE, price: PRICE, endpoint: PUBLIC_URL, payout }),
  });
  const out = await r.json().catch(() => ({}));
  console.log(r.ok && out.ok
    ? `\nRegistered as "${out.name}" (${out.service} @ ${out.price} Cr). Waiting for work…\nWatch: https://setu-mocha.vercel.app/economy.html`
    : `\nRegistration refused: ${out.error ?? r.status}`);
});
