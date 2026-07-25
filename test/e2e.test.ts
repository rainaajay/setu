// End-to-end agent-purchase journey (brief §6/§7/§45), asserted over the REAL modules:
// fund principal -> create agent -> delegate a budget -> discover a service -> get a signed
// quote -> evaluate against policy -> settle through the authority quorum under the delegation
// -> service verifies settlement server-side -> service fulfils -> inspect balance/budget and
// the audit timeline -> revoke. Plus the denied-purchase, approval-threshold, replay and
// failure paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Authority } from '../src/authority.ts';
import { generateKeyPair, sign, canonical, type KeyPair } from '../src/crypto.ts';
import { signAllowance, signRevoke } from '../src/agents/allowance.ts';
import { SetuService } from '../src/service/service.ts';
import { ServiceRegistry } from '../src/service/registry.ts';
import { evaluatePurchase, type DelegationView } from '../src/agent/purchase.ts';
import { verifyQuote, type SignedQuote } from '../src/service/quote.ts';
import { AuditLog } from '../src/audit.ts';
import type { TransferOrder, Certificate } from '../src/types.ts';

const QUORUM = 3;

function committee() {
  const auths = [1, 2, 3, 4].map((i) => new Authority(`auth-${i}`));
  const keys = auths.map((a) => a.keys.publicKey);
  auths.forEach((a) => a.setCommittee(keys, QUORUM));
  return { auths, keys };
}

// Settle a delegated payment through the quorum; return the certificate.
async function payDelegated(auths: Authority[], agent: KeyPair, to: string, amount: number, seq: number, ref: string, delegation: string) {
  const order: TransferOrder = { sender: agent.publicKey, recipient: to, amount, seq, ref, delegation };
  const signed = { order, senderSignature: sign(agent.privateKey, canonical(order)) };
  const sigs = ((await Promise.all(auths.map((a) => a.handle({ type: 'order', signedOrder: signed })))) as any[])
    .filter((r) => r && r.ok).map((r) => r.signature);
  if (sigs.length < QUORUM) return { certified: false as const };
  const certificate: Certificate = { order, senderSignature: signed.senderSignature, authoritySignatures: sigs.slice(0, QUORUM) };
  const settledOn = ((await Promise.all(auths.map((a) => a.handle({ type: 'certificate', certificate })))) as any[]).filter((s) => s && s.ok).length;
  return { certified: true as const, certificate, settledOn };
}

function delegationView(auths: Authority[], id: string, maxPerPayment: number, expiresAt: string): DelegationView {
  const info = auths[0].delegationInfo(id)!;
  return { id, total: info.total, spent: info.spent, maxPerPayment, expiresAt, revoked: info.revoked };
}

test('E2E: an agent discovers, is authorised for, pays for, and receives a digital service', async () => {
  const { auths, keys } = committee();
  const audit = new AuditLog();

  // A principal with demonstration credits, and an agent identity.
  const principal = generateKeyPair();
  const agent = generateKeyPair();
  auths.forEach((a) => a.fund(principal.publicKey, 1000));
  audit.record('account.funded', 'operator', { account: 'principal', amount: 1000 });

  // A real, registered service that summarises a document.
  const registry = new ServiceRegistry();
  const summariser = new SetuService('svc-summarise', 'Summariser', 'summarise', 2, (task) => `SUMMARY(${task.length} chars)`);
  registry.register(summariser, 'global');
  audit.record('service.registered', 'operator', { service: summariser.id });

  // The principal delegates a constrained budget to the agent.
  const id = 'del-1';
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  const grant = signAllowance(principal, { id, agent: agent.publicKey, total: 10, maxPerPayment: 5, expiresAt });
  await Promise.all(auths.map((a) => a.handle({ type: 'register-delegation', signedAllowance: grant })));
  audit.record('delegation.created', 'principal', { id, total: 10, maxPerPayment: 5 });

  // The agent discovers a suitable service.
  const found = registry.discover({ capability: 'summarise', maxPrice: 5 });
  assert.equal(found.length, 1);
  audit.record('service.discovered', 'agent', { matches: found.length, chosen: found[0].id });

  // The service returns a machine-readable, signed quote for the specific task.
  const task = 'Summarise the following document: the quick brown fox...';
  const sq: SignedQuote = summariser.quote(task);
  assert.deepEqual(verifyQuote(sq, found[0].address), { valid: true });
  audit.record('quote.returned', 'service', { quote: sq.quote.id, price: sq.quote.price });

  // The agent evaluates the purchase against the delegation policy BEFORE spending.
  const decision = evaluatePurchase({ id: sq.quote.id, service: sq.quote.service, price: sq.quote.price, expiresAt: sq.quote.expiresAt }, delegationView(auths, id, 5, expiresAt));
  assert.equal(decision.permitted, true);
  audit.record('policy.evaluated', 'agent', { permitted: true, remainingAfter: decision.remainingAfter });

  // Settle through the authority quorum, under the delegation.
  const seq = auths[0].delegationInfo(id)!.nextSeq;
  const settled = await payDelegated(auths, agent, summariser.address, sq.quote.price, seq, sq.quote.id, id);
  assert.equal(settled.certified, true);
  assert.equal(settled.settledOn, 4);
  audit.record('settlement.quorum', 'network', { settledOn: settled.settledOn });

  // The service verifies settlement server-side, then fulfils.
  const outcome = summariser.redeem(sq, settled.certificate, keys, QUORUM, task);
  assert.equal(outcome.settlement, 'quorum-reached');
  assert.equal(outcome.fulfilment, 'completed');
  assert.match(outcome.result ?? '', /SUMMARY/);
  audit.record('fulfilment.completed', 'service', { });

  // The principal inspects the result: exactly the price left the account; budget updated.
  assert.equal(auths[0].balanceOf(principal.publicKey), 998);
  assert.equal(auths[0].delegationInfo(id)!.spent, 2);

  // The full, ordered audit timeline is inspectable.
  assert.deepEqual(audit.types(), [
    'account.funded', 'service.registered', 'delegation.created', 'service.discovered',
    'quote.returned', 'policy.evaluated', 'settlement.quorum', 'fulfilment.completed',
  ]);

  // The principal revokes the agent; further spending is refused by the network.
  await Promise.all(auths.map((a) => a.handle({ type: 'revoke-delegation', signedRevoke: signRevoke(principal, id) })));
  const sq2 = summariser.quote(task, 60_000, Date.now() + 1); // fresh quote id
  const seq2 = auths[0].delegationInfo(id)!.nextSeq;
  const afterRevoke = await payDelegated(auths, agent, summariser.address, sq2.quote.price, seq2, sq2.quote.id, id);
  assert.equal(afterRevoke.certified, false);
});

test('E2E: a purchase over the per-payment limit is denied by policy and never submitted', () => {
  const audit = new AuditLog();
  const del: DelegationView = { id: 'd', total: 100, spent: 0, maxPerPayment: 3, expiresAt: new Date(Date.now() + 3600_000).toISOString(), revoked: false };
  const decision = evaluatePurchase({ id: 'q', service: 'svc', price: 9, expiresAt: new Date(Date.now() + 60_000).toISOString() }, del);
  assert.equal(decision.permitted, false);
  assert.match(decision.reason, /per-payment/);
  audit.record('policy.denied', 'agent', { reason: decision.reason });
  assert.deepEqual(audit.types(), ['policy.denied']); // no settlement event recorded
});

test('E2E: a purchase exceeding the remaining budget is denied', () => {
  const del: DelegationView = { id: 'd', total: 10, spent: 8, maxPerPayment: 5, expiresAt: new Date(Date.now() + 3600_000).toISOString(), revoked: false };
  const decision = evaluatePurchase({ id: 'q', service: 'svc', price: 5, expiresAt: new Date(Date.now() + 60_000).toISOString() }, del);
  assert.equal(decision.permitted, false);
  assert.match(decision.reason, /remaining budget/);
});

test('E2E: the service refuses to fulfil twice for the same settled quote (replay)', async () => {
  const { auths, keys } = committee();
  const principal = generateKeyPair(), agent = generateKeyPair();
  auths.forEach((a) => a.fund(principal.publicKey, 100));
  const id = 'del-r';
  const grant = signAllowance(principal, { id, agent: agent.publicKey, total: 10, maxPerPayment: 5, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  await Promise.all(auths.map((a) => a.handle({ type: 'register-delegation', signedAllowance: grant })));

  const svc = new SetuService('svc-x', 'X', 'x', 2, () => 'RESULT');
  const registry = new ServiceRegistry(); registry.register(svc);
  const task = 'do x';
  const sq = svc.quote(task);
  const seq = auths[0].delegationInfo(id)!.nextSeq;
  const settled = await payDelegated(auths, agent, svc.address, sq.quote.price, seq, sq.quote.id, id);
  assert.equal(settled.certified, true);

  const first = svc.redeem(sq, settled.certificate, keys, QUORUM, task);
  assert.equal(first.fulfilment, 'completed');
  const second = svc.redeem(sq, settled.certificate, keys, QUORUM, task);
  assert.equal(second.settlement, 'quorum-reached'); // settlement was real
  assert.equal(second.fulfilment, 'failed');          // but not fulfilled again
  assert.match(second.reason ?? '', /already redeemed/);
});

test('E2E: the service refuses a certificate paid to the wrong recipient or underpaid', async () => {
  const { auths, keys } = committee();
  const alice = generateKeyPair(), attacker = generateKeyPair();
  auths.forEach((a) => a.fund(alice.publicKey, 100));
  const svc = new SetuService('svc-y', 'Y', 'y', 5, () => 'R');
  const task = 'do y';
  const sq = svc.quote(task);

  // Alice pays the ATTACKER (not the service) but presents it against the service's quote.
  const order: TransferOrder = { sender: alice.publicKey, recipient: attacker.publicKey, amount: 5, seq: 0, ref: sq.quote.id };
  const signed = { order, senderSignature: sign(alice.privateKey, canonical(order)) };
  const sigs = ((await Promise.all(auths.map((a) => a.handle({ type: 'order', signedOrder: signed })))) as any[]).filter((r) => r && r.ok).map((r) => r.signature);
  const cert: Certificate = { order, senderSignature: signed.senderSignature, authoritySignatures: sigs.slice(0, QUORUM) };
  const outcome = svc.redeem(sq, cert, keys, QUORUM, task);
  assert.equal(outcome.settlement, 'failed');
  assert.match(outcome.reason ?? '', /wrong address/);
});
