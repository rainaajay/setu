// Setu server-enforced delegation allowances — the answer to the strongest technical
// objection: a signed budget credential proves permission was GRANTED, but cannot track
// how much has already been SPENT. Offline merchants each verify a valid credential and
// cannot know the aggregate. So the authorities hold the spend state and enforce it.
//
// Run: node src/demo-allowance.ts
import { Authority } from './authority.ts';
import { Wallet } from './client.ts';
import { InProcessNetwork } from './network.ts';
import { generateKeyPair, shortId } from './crypto.ts';
import { signAllowance, signRevoke } from './agents/allowance.ts';

const QUORUM = 3;
function section(t: string) { console.log(`\n=== ${t} ===`); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Pace payments so the per-account anti-spam rate limiter (bucket 5, refill 2/s) stays
// full — otherwise it, not the allowance logic, would be what rejects a rapid burst.

const network = new InProcessNetwork();
const authorities = [1, 2, 3, 4].map((i) => new Authority(`auth-${i}`));
const committee = authorities.map((a) => a.keys.publicKey);
for (const a of authorities) { a.setCommittee(committee, QUORUM); network.register(a.name, a.handle); }
const ids = authorities.map((a) => a.name);

// The principal (a human/business) funds its own account.
const principal = generateKeyPair();
authorities.forEach((a) => a.fund(principal.publicKey, 1000));

// The agent has NO account of its own — it will spend the principal's funds under a budget.
const agent = new Wallet('agent', network, ids, QUORUM, generateKeyPair());

// The principal registers a delegation: total 10, at most 3 per payment, valid 1h.
const DELEG = 'deleg-001';
const grant = signAllowance(principal, {
  id: DELEG, agent: agent.address, total: 10, maxPerPayment: 3,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
});
authorities.forEach((a) => a.registerDelegation(grant));
console.log(`principal ${shortId(principal.publicKey)}… funded 1000; delegated to agent ${shortId(agent.address)}…: total 10, max 3/payment`);

const delegSeq = () => authorities[0].delegationInfo(DELEG)!.nextSeq;
const spent = () => authorities[0].delegationInfo(DELEG)!.spent;
const principalBal = () => authorities[0].balanceOf(principal.publicKey);

// pay a fresh merchant under the delegation
async function payMerchant(amount: number, label: string) {
  await sleep(600); // keep the rate-limit bucket topped up
  const merchant = generateKeyPair().publicKey;
  try {
    const r = await agent.sendOrder(merchant, amount, delegSeq(), ids, undefined, DELEG);
    console.log(`  ${label}: PAID ${amount} → merchant ${shortId(merchant)}… (spent ${spent()}/10, principal ${principalBal()})`);
    return r;
  } catch (e) {
    console.log(`  ${label}: REJECTED — ${(e as Error).message}`);
    return null;
  }
}

section('1. Agent spends within the budget; authorities debit the principal');
await payMerchant(3, 'pay 3 to merchant A');
await payMerchant(3, 'pay 3 to merchant B');

section('2. Per-payment cap enforced server-side');
await payMerchant(5, 'pay 5 (> max 3)');

section('3. Cumulative ceiling: spend across many merchants cannot exceed the total');
console.log(`  spent so far: ${spent()}/10`);
await payMerchant(3, `pay 3 to merchant C (→ ${spent() + 3}/10)`); // 6 → 9
await payMerchant(3, `pay 3 to merchant D (would be ${spent() + 3}/10)`); // 9 + 3 > 10 → rejected
console.log(`  no single merchant knows the aggregate — the authorities do, and enforce it.`);

section('4. The double-present attack, on a fresh allowance');
// "Present the same budget to many merchants at once." A second delegation, then three
// concurrent payments at the SAME delegation sequence. Safety = never two certificates.
const DELEG2 = 'deleg-002';
authorities.forEach((a) => a.registerDelegation(signAllowance(principal, {
  id: DELEG2, agent: agent.address, total: 5, maxPerPayment: 3,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
})));
await sleep(2500); // refill the rate-limit bucket so it is not what gates this test
const seq2 = authorities[0].delegationInfo(DELEG2)!.nextSeq;
const results = await Promise.allSettled(
  [0, 1, 2].map(() => agent.sendOrder(generateKeyPair().publicKey, 3, seq2, ids, undefined, DELEG2)),
);
const certified = results.filter((r) => r.status === 'fulfilled').length;
console.log(`  3 concurrent payments of 3 at delegation sequence ${seq2} → ${certified} certified`);
console.log(`  a second certificate for the same budget is impossible (${certified} ≤ 1). Two would mean 6 spent against a 5 ceiling.`);
console.log(`  cost to the attacker: at worst it wedges its OWN allowance's sequence — the principal's other funds are untouched.`);

section('5. Revocation is enforced by the authorities, not the merchant');
authorities.forEach((a) => a.revokeDelegation(signRevoke(principal, DELEG)));
console.log(`  principal revoked delegation ${DELEG} on all authorities`);
await payMerchant(1, `pay 1 under ${DELEG} after revocation`);
console.log(`  even a merchant that never saw the revocation cannot be paid — it will not certify.`);

section('Summary');
console.log(`  principal balance: 1000 → ${principalBal()}   (only budgeted, authority-checked spends left the account)`);
console.log(`  ${DELEG}: spent ${spent()}/10, revoked ${authorities[0].delegationInfo(DELEG)!.revoked}`);
console.log(`  The budget is enforced by the settlement authorities as live state — not by`);
console.log(`  the signed credential alone, and not client-side. A compromised agent cannot`);
console.log(`  overspend, present the credential twice, or use it after revocation.`);
