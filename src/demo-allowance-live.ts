// Server-enforced spending limits, proven against the LIVE four-region network.
//
// This is the one property no card rail, database or on-chain payment standard offers: the limit is
// enforced by the SETTLEMENT LAYER, not by the merchant, the client, or an app's business logic. A
// principal signs one credential — "this agent may spend N, at most M per payment, until T" — and the
// authorities themselves refuse anything outside it.
//
// Everything printed below is the authorities' own answer over the wire. Nothing is simulated: the
// refusals are the reason the payments do not exist, not a message this script made up.
//
//   npm run demo:allowance:live
//
// Read-only in spirit: it funds a throwaway principal from the public testnet faucet and makes a
// handful of ordinary payments. It performs no destructive or state-corrupting action.
import { readFileSync } from 'node:fs';
import { generateKeyPair, canonical, sign, type KeyPair } from './crypto.ts';
import { signAllowance, signRevoke } from './agents/allowance.ts';
import type { TransferOrder } from './types.ts';

const committee = JSON.parse(readFileSync(new URL('../committee-prod.json', import.meta.url), 'utf8'));
const URLS: string[] = committee.members.map((m: { url: string }) => m.url);
const QUORUM: number = committee.quorum;
const short = (s: string) => s.slice(16, 26) + '…';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(url: string, body: unknown): Promise<any> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return await r.json();
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
const broadcast = (body: unknown) => Promise.all(URLS.map((u) => post(u, body)));

// One delegated payment attempt. Returns the authorities' verdict, verbatim.
async function attempt(agent: KeyPair, _principal: string, delegation: string, amount: number, seq: number) {
  // The SENDER of a delegated order is the AGENT (authority.ts requires order.sender === d.agent);
  // the delegation record is what tells the authorities whose balance to debit.
  const order: TransferOrder = { sender: agent.publicKey, recipient: generateKeyPair().publicKey, amount, seq, delegation };
  const signedOrder = { order, senderSignature: sign(agent.privateKey, canonical(order)) };
  const responses = await broadcast({ type: 'order', signedOrder });
  const sigs = responses.filter((r) => r?.ok).map((r) => r.signature);
  const errors = [...new Set(responses.filter((r) => !r?.ok).map((r) => r.error))];
  if (sigs.length >= QUORUM) {
    const certificate = { order, senderSignature: signedOrder.senderSignature, authoritySignatures: sigs.slice(0, QUORUM) };
    const settles = await broadcast({ type: 'certificate', certificate });
    return { allowed: true, settledOn: settles.filter((s) => s?.ok).length, errors };
  }
  return { allowed: false, signatures: sigs.length, errors };
}

console.log('Setu — server-enforced spending limits, against the live network');
console.log(URLS.join('  '), `\nquorum ${QUORUM} of ${URLS.length}\n`);

const principal = generateKeyPair();
const agent = generateKeyPair();
console.log(`principal ${short(principal.publicKey)}   agent ${short(agent.publicKey)}`);

// Fund the principal from the public testnet faucet.
await Promise.all(URLS.map((u) => post(`${u}/admin/fund`, { address: principal.publicKey, amount: 500 })));
await sleep(1200);
console.log(`funded the principal with 500 test Credits\n`);

// The credential. This is the whole product idea in one object.
const DELEG = 'live-' + Date.now();
const grant = signAllowance(principal, {
  id: DELEG,
  agent: agent.publicKey,
  total: 10,           // the agent may spend 10 in total
  maxPerPayment: 3,    // and never more than 3 in one payment
  expiresAt: new Date(Date.now() + 120_000).toISOString(), // for the next 2 minutes
});
const reg = await broadcast({ type: 'register-delegation', signedAllowance: grant });
console.log(`delegation registered on ${reg.filter((r) => r?.ok).length}/${URLS.length} authorities:`);
console.log(`   "this agent may spend 10 in total, at most 3 per payment, for the next 2 minutes"\n`);

let seq = 0;
const show = (label: string, r: any) => {
  const verdict = r.allowed
    ? `ALLOWED  — settled on ${r.settledOn}/${URLS.length}`
    : `REFUSED  — ${r.signatures}/${QUORUM} signatures; the authorities said: ${r.errors.join(' | ')}`;
  console.log(`${label.padEnd(46)} ${verdict}`);
};

console.log('--- what the network permits, and what it refuses -------------------------');
show('pay 3 (at the per-payment cap)', await attempt(agent, principal.publicKey, DELEG, 3, seq)); seq += 1;
await sleep(700);
show('pay 4 (ABOVE the 3-per-payment cap)', await attempt(agent, principal.publicKey, DELEG, 4, seq));
await sleep(700);
show('pay 3 again (running total now 6)', await attempt(agent, principal.publicKey, DELEG, 3, seq)); seq += 1;
await sleep(700);
show('pay 3 again (running total now 9)', await attempt(agent, principal.publicKey, DELEG, 3, seq)); seq += 1;
await sleep(700);
show('pay 3 more (would exceed the total of 10)', await attempt(agent, principal.publicKey, DELEG, 3, seq));

// Revocation: the principal cancels the credential, and the network stops honouring it at once.
await sleep(700);
const rev = await broadcast({ type: 'revoke-delegation', signedRevoke: signRevoke(principal, DELEG) });
console.log(`\nprincipal revoked the delegation on ${rev.filter((r) => r?.ok).length}/${URLS.length} authorities`);
await sleep(700);
show('pay 1 after revocation', await attempt(agent, principal.publicKey, DELEG, 1, seq));

console.log(`\nEvery refusal above came from the authorities, not from this script.`);
console.log(`The agent held a valid key the whole time — the limit is the network's, not the app's.`);
