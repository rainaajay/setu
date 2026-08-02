// Setu protocol test suite — assertion-based tests over the REAL authority/crypto/
// certificate/delegation code (not the narrative demos). Run: npm test
//
// Covers the invariants in the white paper and the brief §19/§20/§45: no value creation,
// no double-spend, sequence monotonicity, quorum requirement, Byzantine tolerance, offline
// receipt verification, idempotent settlement, deterministic delegation policy, and
// persistence/recovery across an authority restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Authority, EquivocatingAuthority } from '../src/authority.ts';
import { generateKeyPair, sign, verify, canonical, type KeyPair } from '../src/crypto.ts';
import { verifyCertificate } from '../src/certificates.ts';
import { signAllowance, signRevoke } from '../src/agents/allowance.ts';
import type { TransferOrder, SignedOrder, Certificate } from '../src/types.ts';

const QUORUM = 3;

function committee(makeFourth: () => Authority = () => new Authority('auth-4')): { auths: Authority[]; keys: string[] } {
  const auths = [new Authority('auth-1'), new Authority('auth-2'), new Authority('auth-3'), makeFourth()];
  const keys = auths.map((a) => a.keys.publicKey);
  auths.forEach((a) => a.setCommittee(keys, QUORUM));
  return { auths, keys };
}

function signOrder(keys: KeyPair, order: TransferOrder): SignedOrder {
  return { order, senderSignature: sign(keys.privateKey, canonical(order)) };
}

// Submit an order to every authority and collect the authority signatures that came back.
async function submit(auths: Authority[], signedOrder: SignedOrder): Promise<any[]> {
  const res = await Promise.all(auths.map((a) => a.handle({ type: 'order', signedOrder })));
  return (res as any[]).filter((r) => r && r.ok).map((r) => r.signature);
}

function makeCert(signedOrder: SignedOrder, sigs: any[]): Certificate {
  return { order: signedOrder.order, senderSignature: signedOrder.senderSignature, authoritySignatures: sigs.slice(0, QUORUM) };
}

async function apply(auths: Authority[], certificate: Certificate): Promise<number> {
  const res = await Promise.all(auths.map((a) => a.handle({ type: 'certificate', certificate })));
  return (res as any[]).filter((s) => s && s.ok).length;
}

// Full account-to-account payment. Returns whether it reached a quorum and settled.
async function pay(auths: Authority[], from: KeyPair, to: string, amount: number, seq: number, ref?: string, delegation?: string) {
  const order: TransferOrder = { sender: from.publicKey, recipient: to, amount, seq };
  if (ref !== undefined) order.ref = ref;
  if (delegation !== undefined) order.delegation = delegation;
  const signed = signOrder(from, order);
  const sigs = await submit(auths, signed);
  if (sigs.length < QUORUM) return { certified: false as const, sigs: sigs.length };
  const cert = makeCert(signed, sigs);
  const settledOn = await apply(auths, cert);
  return { certified: true as const, certificate: cert, settledOn };
}

const supply = (a: Authority, addrs: string[]) => addrs.reduce((s, x) => s + a.balanceOf(x), 0);

// --- cryptography -------------------------------------------------------------------
test('signatures verify, reject tampering, and canonical JSON is key-order independent', () => {
  const k = generateKeyPair();
  const sig = sign(k.privateKey, 'hello');
  assert.equal(verify(k.publicKey, 'hello', sig), true);
  assert.equal(verify(k.publicKey, 'hello!', sig), false);
  assert.equal(verify(generateKeyPair().publicKey, 'hello', sig), false);
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
});

// --- happy path ---------------------------------------------------------------------
test('a funded payment reaches a quorum and every authority agrees on the new balances', async () => {
  const { auths } = committee();
  const alice = generateKeyPair(), bob = generateKeyPair();
  auths.forEach((a) => a.fund(alice.publicKey, 100));
  const r = await pay(auths, alice, bob.publicKey, 30, 0);
  assert.equal(r.certified, true);
  assert.equal(r.settledOn, 4);
  for (const a of auths) {
    assert.equal(a.balanceOf(alice.publicKey), 70);
    assert.equal(a.balanceOf(bob.publicKey), 30);
  }
});

// --- invariant: no value creation ---------------------------------------------------
test('transfers conserve value — total balance never changes across a chain of payments', async () => {
  const { auths } = committee();
  const a = generateKeyPair(), b = generateKeyPair(), c = generateKeyPair();
  auths.forEach((x) => x.fund(a.publicKey, 100));
  const addrs = [a, b, c].map((k) => k.publicKey);
  assert.equal(supply(auths[0], addrs), 100);
  await pay(auths, a, b.publicKey, 40, 0);
  await pay(auths, b, c.publicKey, 15, 0);
  await pay(auths, a, c.publicKey, 10, 1);
  assert.equal(supply(auths[0], addrs), 100); // nothing minted or burned
});

// --- invariant: no double-spend, and sequence monotonicity --------------------------
test('a conflicting second order at the same sequence cannot form a certificate', async () => {
  const { auths } = committee();
  const alice = generateKeyPair(), bob = generateKeyPair(), carol = generateKeyPair();
  auths.forEach((a) => a.fund(alice.publicKey, 50));
  // First order locks the sequence on each honest authority.
  const first = signOrder(alice, { sender: alice.publicKey, recipient: bob.publicKey, amount: 50, seq: 0 });
  await submit(auths, first);
  // Conflicting order at the same seq: honest authorities refuse to sign it.
  const conflicting = signOrder(alice, { sender: alice.publicKey, recipient: carol.publicKey, amount: 50, seq: 0 });
  const sigs = await submit(auths, conflicting);
  assert.ok(sigs.length < QUORUM, 'conflicting order must not reach a quorum');
});

test('a settled sequence cannot be replayed (sequence numbers do not move backwards)', async () => {
  const { auths } = committee();
  const alice = generateKeyPair(), bob = generateKeyPair();
  auths.forEach((a) => a.fund(alice.publicKey, 50));
  await pay(auths, alice, bob.publicKey, 10, 0); // advances nextSeq to 1
  const replay = await pay(auths, alice, bob.publicKey, 10, 0); // stale seq
  assert.equal(replay.certified, false);
  assert.equal(auths[0].balanceOf(alice.publicKey), 40); // only one debit
});

test('an order exceeding the balance cannot certify', async () => {
  const { auths } = committee();
  const alice = generateKeyPair(), bob = generateKeyPair();
  auths.forEach((a) => a.fund(alice.publicKey, 5));
  const r = await pay(auths, alice, bob.publicKey, 999, 0);
  assert.equal(r.certified, false);
  assert.equal(auths[0].balanceOf(alice.publicKey), 5);
});

// --- Byzantine tolerance ------------------------------------------------------------
test('a Byzantine authority signing everything still cannot enable a double-spend', async () => {
  const { auths } = committee(() => new EquivocatingAuthority('auth-4*'));
  const alice = generateKeyPair(), bob = generateKeyPair(), carol = generateKeyPair();
  auths.forEach((a) => a.fund(alice.publicKey, 50));
  const rA = await pay(auths, alice, bob.publicKey, 50, 0);
  assert.equal(rA.certified, true); // legitimate payment certifies
  // Second, conflicting payment at the same seq: needs 3 sigs, but 3 honest authorities
  // already advanced past seq 0, so at most the 1 Byzantine signs it.
  const rB = await pay(auths, alice, carol.publicKey, 50, 0);
  assert.equal(rB.certified, false);
  assert.equal(auths[0].balanceOf(bob.publicKey), 50);
  assert.equal(auths[0].balanceOf(carol.publicKey), 0);
});

// --- offline receipt verification (§14) ---------------------------------------------
test('a valid certificate verifies offline; tampering, short quorum, and foreign signers are rejected', async () => {
  const { auths, keys } = committee();
  const alice = generateKeyPair(), bob = generateKeyPair();
  auths.forEach((a) => a.fund(alice.publicKey, 40));
  const r = await pay(auths, alice, bob.publicKey, 10, 0);
  assert.equal(r.certified, true);
  const cert = (r as any).certificate as Certificate;
  assert.deepEqual(verifyCertificate(cert, keys, QUORUM), { valid: true });
  // tampered amount
  const tampered: Certificate = { ...cert, order: { ...cert.order, amount: 1000 } };
  assert.equal(verifyCertificate(tampered, keys, QUORUM).valid, false);
  // too few signatures
  const short: Certificate = { ...cert, authoritySignatures: cert.authoritySignatures.slice(0, 2) };
  assert.equal(verifyCertificate(short, keys, QUORUM).valid, false);
  // a signer not on the committee is not counted
  assert.equal(verifyCertificate(cert, keys.slice(0, 2), QUORUM).valid, false);
});

// --- idempotent settlement ----------------------------------------------------------
test('applying the same certificate twice does not double-credit the recipient', async () => {
  const { auths } = committee();
  const alice = generateKeyPair(), bob = generateKeyPair();
  auths.forEach((a) => a.fund(alice.publicKey, 40));
  const r = await pay(auths, alice, bob.publicKey, 25, 0);
  assert.equal(r.certified, true);
  await apply(auths, (r as any).certificate); // replay the certificate
  assert.equal(auths[0].balanceOf(bob.publicKey), 25); // still 25, not 50
  assert.equal(auths[0].balanceOf(alice.publicKey), 15);
});

// --- deterministic delegation policy (§8/§9) ----------------------------------------
test('delegated spending is enforced by the authorities: caps, cumulative total, expiry, revocation, identity', async () => {
  const { auths } = committee();
  const principal = generateKeyPair(), agent = generateKeyPair(), stranger = generateKeyPair();
  auths.forEach((a) => a.fund(principal.publicKey, 1000));

  const id = 'd1';
  const grant = signAllowance(principal, { id, agent: agent.publicKey, total: 10, maxPerPayment: 3, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  await Promise.all(auths.map((a) => a.handle({ type: 'register-delegation', signedAllowance: grant })));

  const spend = async (amount: number, who: KeyPair = agent) => {
    const seq = auths[0].delegationInfo(id)!.nextSeq;
    return pay(auths, who, generateKeyPair().publicKey, amount, seq, undefined, id);
  };

  assert.equal((await spend(3)).certified, true);   // within budget
  assert.equal((await spend(3)).certified, true);   // spent 6
  assert.equal((await spend(5)).certified, false);  // over per-payment cap (3)
  assert.equal((await spend(3)).certified, true);   // spent 9
  assert.equal((await spend(3)).certified, false);  // 9+3 > 10 total → exhausted
  assert.equal((await spend(1, stranger)).certified, false); // not the delegated agent

  assert.equal(auths[0].delegationInfo(id)!.spent, 9);
  assert.equal(auths[0].balanceOf(principal.publicKey), 991); // only budgeted spend left the account

  // revocation is enforced server-side
  await Promise.all(auths.map((a) => a.handle({ type: 'revoke-delegation', signedRevoke: signRevoke(principal, id) })));
  assert.equal((await spend(1)).certified, false);

  // expiry is enforced
  const id2 = 'd2';
  const expired = signAllowance(principal, { id: id2, agent: agent.publicKey, total: 10, maxPerPayment: 5, expiresAt: new Date(Date.now() - 1000).toISOString() });
  await Promise.all(auths.map((a) => a.handle({ type: 'register-delegation', signedAllowance: expired })));
  const seq2 = auths[0].delegationInfo(id2)!.nextSeq;
  assert.equal((await pay(auths, agent, generateKeyPair().publicKey, 1, seq2, undefined, id2)).certified, false);
});

// A principal's balance is one pool, but the direct-account lock and each delegation lock
// are separate tracks. Without a cross-track reservation, a direct spend and a delegated
// spend on the SAME balance each pass an independent balance check and both settle, driving
// the balance negative — minting value. This asserts they cannot both certify+settle, that
// supply is conserved, and that the balance never goes negative (honest concurrent use:
// principal spends while its own agent spends).
test('a direct spend and a delegated spend cannot both drain one balance (no cross-track double-spend)', async () => {
  const { auths } = committee();
  const principal = generateKeyPair(), agent = generateKeyPair();
  const merchantA = generateKeyPair(), merchantB = generateKeyPair();
  auths.forEach((a) => a.fund(principal.publicKey, 100));
  const id = 'dd';
  const grant = signAllowance(principal, { id, agent: agent.publicKey, total: 100, maxPerPayment: 100, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  await Promise.all(auths.map((a) => a.handle({ type: 'register-delegation', signedAllowance: grant })));

  // Both draw the full 100 from the one principal balance, concurrently.
  const dseq = auths[0].delegationInfo(id)!.nextSeq;
  const delegated = pay(auths, agent, merchantA.publicKey, 100, dseq, undefined, id);
  const direct = pay(auths, principal, merchantB.publicKey, 100, 0);
  const [rd, rr] = await Promise.all([delegated, direct]);

  const bothSettled = rd.certified && rd.settledOn >= QUORUM && rr.certified && rr.settledOn >= QUORUM;
  assert.equal(bothSettled, false, 'a direct and a delegated spend must NOT both settle out of one balance');
  const addrs = [principal, merchantA, merchantB].map((k) => k.publicKey);
  assert.equal(supply(auths[0], addrs), 100, 'total supply must be conserved — no minting');
  for (const a of auths) assert.ok(a.balanceOf(principal.publicKey) >= 0, 'principal balance must never go negative');
});

test('a forged allowance (bad principal signature) is rejected on registration', async () => {
  const { auths } = committee();
  const principal = generateKeyPair(), agent = generateKeyPair();
  const grant = signAllowance(principal, { id: 'x', agent: agent.publicKey, total: 10, maxPerPayment: 3, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  (grant.allowance as any).total = 1_000_000; // tamper after signing
  const res = (await auths[0].handle({ type: 'register-delegation', signedAllowance: grant })) as any;
  assert.equal(res.ok, false);
});

// --- persistence & recovery (§20) ---------------------------------------------------
test('authority state (balances, sequence, delegation spend) survives a restart from disk', async () => {
  const dir = join(tmpdir(), `setu-test-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  try {
    const files = [1, 2, 3, 4].map((i) => join(dir, `auth-${i}.json`));
    const auths = files.map((f, i) => new Authority(`auth-${i + 1}`, undefined, f));
    const keys = auths.map((a) => a.keys.publicKey);
    auths.forEach((a) => a.setCommittee(keys, QUORUM));

    const principal = generateKeyPair(), agent = generateKeyPair();
    auths.forEach((a) => a.fund(principal.publicKey, 500));
    const id = 'dp';
    const grant = signAllowance(principal, { id, agent: agent.publicKey, total: 20, maxPerPayment: 10, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    await Promise.all(auths.map((a) => a.handle({ type: 'register-delegation', signedAllowance: grant })));
    await pay(auths, agent, generateKeyPair().publicKey, 8, 0, undefined, id); // delegated spend

    assert.equal(existsSync(files[0]), true);
    // Reload authority-1 from its file with fresh keys — state must come back.
    const reloaded = new Authority('auth-1', undefined, files[0]);
    assert.equal(reloaded.balanceOf(principal.publicKey), 492);
    assert.equal(reloaded.delegationInfo(id)!.spent, 8);
    assert.equal(reloaded.delegationInfo(id)!.nextSeq, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The public faucet is intentionally open (Credits are closed-loop TEST units and the browser wallet
// depends on it), but it must never be able to corrupt state. A negative amount would DRAIN an account
// and break value conservation; a non-integer would NaN a balance. Both are rejected at the library
// level, so no caller — HTTP or in-process — can reach state with them.
test('faucet rejects negative, zero, and non-integer amounts (cannot corrupt balances)', () => {
  const a = new Authority('auth-1');
  const alice = generateKeyPair().publicKey;

  assert.equal(a.fund(alice, 100).ok, true);
  assert.equal(a.balanceOf(alice), 100);

  for (const bad of [-50, 0, 1.5, NaN, Infinity, -Infinity]) {
    const r = a.fund(alice, bad as number);
    assert.equal(r.ok, false, `amount ${bad} must be rejected`);
    assert.equal(a.balanceOf(alice), 100, `balance must be untouched after amount ${bad}`);
  }
  // a malformed address is refused too, and creates no account
  assert.equal(a.fund('short', 10).ok, false);
  assert.equal(a.balanceOf('short'), 0);
});
