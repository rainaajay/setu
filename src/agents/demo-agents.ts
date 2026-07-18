// Setu agent-commerce demo — machine-to-machine payments over the LIVE 4-continent
// network. Run: node src/agents/demo-agents.ts   (uses committee-prod.json by default)
//
// Cast:
//   principal  — the human ("ajay" from wallets.json). Signs ONE delegation, then does nothing.
//   buyer      — an agent with its own key, funded by the principal, bound by the
//                delegated spend policy (budget 10, max 2 per payment, 1h expiry).
//   merchant   — an agent selling market quotes at 1 unit each. Payment-gated: it serves
//                a quote only against a certificate whose ref matches the invoice —
//                verified offline with committee public keys. No account, no API key,
//                no card on file: possession of a valid certificate IS the credential.
//   sentinel   — the oversight agent: after the session it audits all four authorities
//                for cross-region agreement on every account involved.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importKeyPair, generateKeyPair, shortId } from '../crypto.ts';
import { HttpNetwork } from '../httpNetwork.ts';
import { Wallet } from '../client.ts';
import { verifyCertificate } from '../certificates.ts';
import { createDelegation, verifyDelegation, type SpendPolicy } from './delegation.ts';
import { memberUrl, COMMITTEE_PATH, type CommitteeFile } from '../keygen.ts';
import type { Certificate } from '../types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const committeePath =
  process.env.SETU_COMMITTEE ?? join(root, 'committee-prod.json');
const committee: CommitteeFile = JSON.parse(readFileSync(committeePath, 'utf8'));
const committeeKeys = committee.members.map((m) => m.publicKey);
const peers = Object.fromEntries(committee.members.map((m) => [m.name, memberUrl(m)]));
const ids = committee.members.map((m) => m.name);
const network = new HttpNetwork(peers);
console.log(`network: ${Object.values(peers).join(', ')}`);

async function networkSeq(address: string): Promise<number> {
  const views = await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await fetch(`${peers[id]}/account?address=${encodeURIComponent(address)}`, {
          signal: AbortSignal.timeout(8000),
        });
        return ((await r.json()) as { nextSeq: number }).nextSeq;
      } catch {
        return -1;
      }
    }),
  );
  return Math.max(...views);
}

// --- principal: sign one delegation, then leave the agents to it -------------------
const walletsFile = JSON.parse(readFileSync(join(root, 'wallets.json'), 'utf8')) as Record<
  string,
  { publicKey: string; privateKey: string }
>;
const principalKeys = importKeyPair(walletsFile.ajay.publicKey, walletsFile.ajay.privateKey);
const buyerKeys = generateKeyPair();
const merchantKeys = generateKeyPair();

const delegation = createDelegation(principalKeys, buyerKeys.publicKey, {
  budget: 10,
  maxPerPayment: 2,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
});
console.log(
  `principal ${shortId(principalKeys.publicKey)}… delegated to buyer agent ${shortId(buyerKeys.publicKey)}…: budget 10, max 2/payment, 1h expiry`,
);

// fund the buyer agent from the principal's real balance — an actual settled transfer
const principalWallet = new Wallet('ajay', network, ids, committee.quorum, principalKeys);
const fundSeq = await networkSeq(principalKeys.publicKey);
const funding = await principalWallet.sendOrder(buyerKeys.publicKey, 15, fundSeq, ids);
console.log(`principal funded buyer agent with 15 units — FINAL in ${funding.latencyMs.toFixed(0)}ms\n`);

// --- merchant agent: payment-gated quote service -----------------------------------
const invoices = new Map<string, { price: number; symbol: string }>();
const redeemed = new Set<string>();
const merchant = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1:7300');
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && url.pathname === '/quote') {
    // no payment presented → 402 with an invoice (the feeless x402 pattern)
    const id = randomUUID();
    const symbol = url.searchParams.get('symbol') ?? 'UNKNOWN';
    invoices.set(id, { price: 1, symbol });
    json(402, { invoice: { id, price: 1, payTo: merchantKeys.publicKey } });
  } else if (req.method === 'POST' && url.pathname === '/quote') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { invoiceId, certificate, delegation: presented } = JSON.parse(body) as {
      invoiceId: string;
      certificate: Certificate;
      delegation: Parameters<typeof verifyDelegation>[0];
    };
    const invoice = invoices.get(invoiceId);
    if (!invoice) return json(400, { error: 'unknown invoice' });
    if (redeemed.has(invoiceId)) return json(400, { error: 'invoice already redeemed' });
    const cert = verifyCertificate(certificate, committeeKeys, committee.quorum);
    if (!cert.valid) return json(402, { error: `bad certificate: ${cert.error}` });
    if (certificate.order.ref !== invoiceId) return json(402, { error: 'certificate not for this invoice' });
    if (certificate.order.recipient !== merchantKeys.publicKey) return json(402, { error: 'paid to wrong address' });
    if (certificate.order.amount < invoice.price) return json(402, { error: 'underpaid' });
    const del = verifyDelegation(presented, certificate.order.sender);
    if ('error' in del) return json(403, { error: `delegation rejected: ${del.error}` });
    redeemed.add(invoiceId);
    json(200, {
      symbol: invoice.symbol,
      mid: (100 + Math.random() * 50).toFixed(2),
      servedTo: `agent of ${shortId(del.principal)}…`,
    });
  } else json(404, {});
});
await new Promise<void>((r) => merchant.listen(7300, '127.0.0.1', r));
console.log('merchant agent up on 127.0.0.1:7300 — sells quotes at 1 unit, payment-gated\n');

// --- buyer agent: policy-enforced procurement loop ---------------------------------
const buyerWallet = new Wallet('buyer', network, ids, committee.quorum, buyerKeys);
const policy: SpendPolicy = { type: 'delegation', budget: 10, maxPerPayment: 2, expiresAt: '' };
let spent = 0;
let seq = await networkSeq(buyerKeys.publicKey);
const latencies: number[] = [];
const symbols = ['NEM', 'MSTR', 'BTC', 'AU', 'CL', 'ES', 'DAX', 'NKY', 'SPX', 'GLD', 'SI', 'HG'];

for (const symbol of symbols) {
  const quoteReq = await fetch(`http://127.0.0.1:7300/quote?symbol=${symbol}`);
  const { invoice } = (await quoteReq.json()) as {
    invoice: { id: string; price: number; payTo: string };
  };

  // the delegated policy is enforced BEFORE money moves
  if (invoice.price > policy.maxPerPayment) {
    console.log(`buyer: refusing ${symbol} — price ${invoice.price} exceeds maxPerPayment`);
    continue;
  }
  if (spent + invoice.price > policy.budget) {
    console.log(`buyer: POLICY STOP — budget ${policy.budget} exhausted (spent ${spent}); ${symbol} not bought`);
    break;
  }

  // pay over the live network, retrying through the feeless rate limit if throttled
  let paid = null;
  for (let attempt = 0; attempt < 5 && !paid; attempt++) {
    try {
      paid = await buyerWallet.sendOrder(invoice.payTo, invoice.price, seq, ids, invoice.id);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('rate limited')) {
        console.log(`buyer: rate limited — backing off 700ms (feeless anti-spam at work)`);
        await new Promise((r) => setTimeout(r, 700));
      } else throw e;
    }
  }
  if (!paid) { console.log('buyer: could not pay after retries'); break; }
  seq += 1;
  spent += invoice.price;
  latencies.push(paid.latencyMs);

  const redeem = await fetch('http://127.0.0.1:7300/quote', {
    method: 'POST',
    body: JSON.stringify({ invoiceId: invoice.id, certificate: paid.certificate, delegation }),
  });
  const data = (await redeem.json()) as { symbol?: string; mid?: string; error?: string };
  console.log(
    data.error
      ? `buyer: merchant refused: ${data.error}`
      : `bought ${data.symbol} @ ${data.mid} — paid 1 unit, FINAL in ${paid.latencyMs.toFixed(0)}ms (spent ${spent}/${policy.budget})`,
  );
}

const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
console.log(`\nsession: ${latencies.length} paid requests, ${spent} units, avg finality ${avg.toFixed(0)}ms per micropayment`);

// --- adversarial check: merchant must reject a replayed certificate ----------------
const replayReq = await fetch('http://127.0.0.1:7300/quote?symbol=REPLAY');
const { invoice: replayInv } = (await replayReq.json()) as { invoice: { id: string } };
const replay = await fetch('http://127.0.0.1:7300/quote', {
  method: 'POST',
  body: JSON.stringify({
    invoiceId: replayInv.id,
    certificate: { order: { sender: buyerKeys.publicKey, recipient: merchantKeys.publicKey, amount: 1, seq: 0, ref: replayInv.id }, senderSignature: 'AAAA', authoritySignatures: [] },
    delegation,
  }),
});
console.log(`forged/unpaid certificate presented → merchant says: ${((await replay.json()) as { error: string }).error}`);

// --- sentinel agent: cross-region audit ---------------------------------------------
console.log('\nsentinel audit — do all four regions agree?');
for (const [label, addr] of [
  ['principal', principalKeys.publicKey],
  ['buyer agent', buyerKeys.publicKey],
  ['merchant agent', merchantKeys.publicKey],
] as const) {
  const views = await Promise.all(
    ids.map(async (id) => {
      const r = await fetch(`${peers[id]}/account?address=${encodeURIComponent(addr)}`);
      const v = (await r.json()) as { balance: number; nextSeq: number };
      return `${id}:${v.balance}`;
    }),
  );
  const balances = new Set(views.map((v) => v.split(':')[1]));
  console.log(`  ${label.padEnd(14)} ${views.join('  ')}  ${balances.size === 1 ? '— CONSISTENT' : '— DIVERGENT (investigate!)'}`);
}

merchant.close();
