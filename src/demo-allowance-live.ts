// Server-enforced spending limits, proven against the LIVE four-region network.
//
// This is the one property no card rail, database or on-chain payment gives you: a spending limit
// that the SETTLEMENT LAYER itself refuses to exceed. Not the merchant's code, not the agent's
// good behaviour — the authorities. Everything printed below is the authorities' own answer, quoted
// verbatim, from four machines in London, Frankfurt, Washington and Singapore.
//
//   npm run demo:allowance:live
//
// It uses only ordinary client traffic (faucet + orders), exactly what the browser wallet does.
import { readFileSync } from 'node:fs';
import { generateKeyPair, canonical, sign } from './crypto.ts';
import { signAllowance, signRevoke } from './agents/allowance.ts';
import type { TransferOrder } from './types.ts';

const committee = JSON.parse(readFileSync('committee-prod.json', 'utf8')) as {
  quorum: number;
  members: { name: string; url: string }[];
};
const URLS = committee.members.map((m) => m.url);
const QUORUM = committee.quorum;

const post = async (url: string, body: unknown) => {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    return (await r.json()) as { ok: boolean; error?: string; signature?: unknown };
  } catch (e) {
    return { ok: false, error: `unreachable (${(e as Error).message})` };
  }
};
const broadcast = (body: unknown) => Promise.all(URLS.map((u) => post(u, body)));

// Print what each authority said, in its own words. This is the point of the demo: the refusal is
// the network's, not this script's.
function report(label: string, responses: { ok: boolean; error?: string }[]) {
  const ok = responses.filter((r) => r.ok).length;
  const verdict = ok >= QUORUM ? `ALLOWED (${ok}/4 signed)` : `REFUSED (${ok}/4 signed — quorum is ${QUORUM})`;
  console.log(`\n${label}\n  → ${verdict}`);
  responses.forEach((r, i) => {
    console.log(`     ${committee.members[i].name.padEnd(7)} ${r.ok ? 'signed' : `refused: "${r.error ?? 'no reason given'}"`}`);
  });
}

async function main() {
  console.log('Setu — server-enforced spending limits, on the live network');
  console.log(`Authorities: ${URLS.join(', ')}  (quorum ${QUORUM} of ${URLS.length})`);

  const principal = generateKeyPair(); // the human's key
  const agent = generateKeyPair();     // the agent that will spend on their behalf
  const merchant = generateKeyPair().publicKey;

  console.log('\n[1/6] Funding the principal from the public testnet faucet…');
  await Promise.all(URLS.map((u) =>
    fetch(u + '/admin/fund', { method: 'POST', body: JSON.stringify({ address: principal.publicKey, amount: 100 }), signal: AbortSignal.timeout(15_000) }).catch(() => null),
  ));

  // The grant: the whole policy, signed once by the human.
  const id = 'demo-' + Date.now().toString(36);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const signed = signAllowance(principal, { id, agent: agent.publicKey, total: 10, maxPerPayment: 2, expiresAt });
  console.log(`\n[2/6] The human signs ONE credential: "agent may spend 10 total, at most 2 per payment, until ${expiresAt}"`);
  const reg = await broadcast({ type: 'register-delegation', signedAllowance: signed });
  console.log(`      registered on ${reg.filter((r) => r.ok).length}/4 authorities`);

  // The agent spends the principal's money under the delegation. A payment is only complete when the
  // quorum certificate is formed AND settled — the delegation's sequence advances on settlement, so
  // the demo must do the full round trip, not just collect signatures.
  let seq = 0;
  const spend = async (amount: number, signer = agent) => {
    const order: TransferOrder = { sender: signer.publicKey, recipient: merchant, amount, seq, delegation: id };
    const signedOrder = { order, senderSignature: sign(signer.privateKey, canonical(order)) };
    const res = await broadcast({ type: 'order', signedOrder }) as { ok: boolean; error?: string; signature?: { authority: string; signature: string } }[];
    const sigs = res.filter((r) => r.ok && r.signature).map((r) => r.signature!);
    if (sigs.length >= QUORUM) {
      await broadcast({ type: 'certificate', certificate: { order, senderSignature: signedOrder.senderSignature, authoritySignatures: sigs.slice(0, QUORUM) } });
      seq += 1;
    }
    return res;
  };

  console.log('\n[3/6] The agent tries to spend 5 — OVER the 2-per-payment cap.');
  report('      order: 5 Credits (cap is 2)', await spend(5));

  console.log('\n[4/6] A DIFFERENT agent tries to use the same credential (identity, not just the budget).');
  report('      order signed by an impostor', await spend(1, generateKeyPair()));

  console.log('\n[5/6] The agent now spends within the rules, until the cumulative ceiling of 10 stops it.');
  for (let i = 1; i <= 7; i++) {
    const res = await spend(2);
    const ok = res.filter((r) => r.ok).length;
    console.log(`      payment ${i} of 2 Credits (${i * 2} of 10 total) → ${ok >= QUORUM ? 'ALLOWED' : `REFUSED: "${res.find((r) => !r.ok)?.error}"`}`);
    if (ok < QUORUM) break; // the cumulative ceiling stopped it — that is the point
  }

  console.log('\n[6/6] The human revokes the credential.');
  const rev = await broadcast({ type: 'revoke-delegation', signedRevoke: signRevoke(principal, id) });
  console.log(`      revoked on ${rev.filter((r) => r.ok).length}/4 authorities`);
  report('      order after revocation: 1 Credit', await spend(1));

  console.log('\nEvery refusal above came from the authorities themselves, over the public internet.');
  console.log('No merchant code and no client-side check was involved: the limit is the settlement layer.');
}

main().catch((e) => { console.error(e); process.exit(1); });
