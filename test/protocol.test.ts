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

// §18 — PARTITION / CATCH-UP. Settlement is client-driven: there is no authority-to-authority
// anti-entropy, so an authority that misses a certificate (partition, timeout, client crash after
// collecting quorum from the other three) falls behind and REFUSES later certificates with a
// sequence gap. This test pins the real boundary: SAFETY holds throughout (the lagging authority can
// never be used to double-spend, because the healthy majority still holds the first-seen lock), and
// the lagging authority HEALS when the missed certificates are replayed to it in order.
test('a partitioned authority stalls on a sequence gap, cannot be double-spent against, and heals on ordered replay', async () => {
  const { auths } = committee();
  const alice = generateKeyPair();
  const bob = generateKeyPair().publicKey;
  const carol = generateKeyPair().publicKey;
  auths.forEach((a) => a.fund(alice.publicKey, 1000));

  const healthy = auths.slice(0, 3); // auth-4 is partitioned for settlement
  const lagging = auths[3];

  // Two payments certify with a full quorum, but the certificates reach only the healthy three.
  const certs: Certificate[] = [];
  for (let seq = 0; seq < 2; seq++) {
    const order: TransferOrder = { sender: alice.publicKey, recipient: bob, amount: 100, seq };
    const signed = signOrder(alice, order);
    const sigs = await submit(auths, signed);          // all four sign (they are reachable)
    assert.ok(sigs.length >= QUORUM);
    const cert = makeCert(signed, sigs);
    assert.equal(await apply(healthy, cert), 3);       // but only the healthy three APPLY it
    certs.push(cert);
  }

  // The lagging authority is now behind: it never applied seq 0 or 1.
  assert.equal(lagging.balanceOf(alice.publicKey), 1000, 'lagging authority still shows the old balance');
  assert.equal(healthy[0].balanceOf(alice.publicKey), 800);

  // A later certificate is REFUSED by the lagging authority — an explicit gap, not silent divergence.
  const order2: TransferOrder = { sender: alice.publicKey, recipient: bob, amount: 100, seq: 2 };
  const signed2 = signOrder(alice, order2);
  const sigs2 = await submit(auths, signed2);
  const cert2 = makeCert(signed2, sigs2);
  const gap = await lagging.handle({ type: 'certificate', certificate: cert2 }) as any;
  assert.equal(gap.ok, false);
  assert.match(gap.error, /sequence gap/);

  // SAFETY: the lagging authority cannot be used to double-spend. A conflicting order at an
  // already-settled sequence cannot collect a quorum, because the healthy majority holds the lock.
  const conflicting: TransferOrder = { sender: alice.publicKey, recipient: carol, amount: 100, seq: 0 };
  const conflictSigs = await submit(auths, signOrder(alice, conflicting));
  assert.ok(conflictSigs.length < QUORUM, 'a conflicting spend must never reach quorum via the lagging authority');

  // HEAL: replay the missed certificates in order, then the previously-refused one.
  for (const c of certs) assert.equal((await lagging.handle({ type: 'certificate', certificate: c }) as any).ok, true);
  assert.equal((await lagging.handle({ type: 'certificate', certificate: cert2 }) as any).ok, true);
  await apply(healthy, cert2);

  // All four authorities now agree, and value is conserved.
  const addrs = [alice.publicKey, bob, carol];
  for (const a of auths) {
    assert.equal(a.balanceOf(alice.publicKey), 700, `${a.name} healed to the same balance`);
    assert.equal(a.balanceOf(bob), 300);
    assert.equal(supply(a, addrs), 1000, 'no value created or destroyed by the partition');
  }
});

// The settlement writer is the last place balances change, so it validates its own inputs instead of
// trusting handleOrder. NaN is the dangerous case: every comparison against NaN is false, so a NaN
// amount does NOT trip the `balance - reserved < amount` spend guard — unguarded, it would defeat the
// balance check entirely and poison the balance permanently.
test('a quorum-signed certificate with a bad amount is refused and leaves balances untouched', async () => {
  const { auths } = committee();
  const alice = generateKeyPair();
  const bob = generateKeyPair().publicKey;
  auths.forEach((a) => a.fund(alice.publicKey, 500));

  for (const bad of [-500, 0, 1.5, NaN]) {
    const order = { sender: alice.publicKey, recipient: bob, amount: bad as number, seq: 0 } as TransferOrder;
    const signed = signOrder(alice, order);
    // Force a full quorum of authority signatures over the malformed order, so the ONLY thing that
    // can stop it is handleCertificate's own guard.
    const sigs = auths.map((a) => ({ authority: a.keys.publicKey, signature: sign(a.keys.privateKey, canonical(order)) }));
    const res = await auths[0].handle({ type: 'certificate', certificate: { order, senderSignature: signed.senderSignature, authoritySignatures: sigs.slice(0, QUORUM) } }) as any;
    assert.equal(res.ok, false, `amount ${bad} must be refused at settlement`);
    assert.equal(auths[0].balanceOf(alice.publicKey), 500, `sender untouched after amount ${bad}`);
    assert.equal(auths[0].balanceOf(bob), 0, `recipient untouched after amount ${bad}`);
  }
});

test('self-payments are never signed and never settle (they would inflate the public counters)', async () => {
  const { auths } = committee();
  const alice = generateKeyPair();
  auths.forEach((a) => a.fund(alice.publicKey, 100));
  const before = auths[0].stats();

  for (let i = 0; i < 5; i++) {
    const r = await pay(auths, alice, alice.publicKey, 100, i);
    assert.equal(r.certified, false, 'a self-payment must not reach quorum');
  }
  const after = auths[0].stats();
  assert.equal(after.settled, before.settled, 'settled counter must not move');
  assert.equal(after.volume, before.volume, 'volume counter must not move');
  assert.equal(auths[0].balanceOf(alice.publicKey), 100, 'balance unchanged');
});

// A settle leg that fails used to be dropped silently, leaving that authority permanently behind —
// it then refuses every LATER certificate from the same sender with a sequence gap, because there is
// no authority-to-authority anti-entropy. Measured live, one authority was missing 7 of 41 payments
// this way. The client now retries the stragglers in the background, so the ledger converges.
test('a settle leg that fails is retried until the lagging authority catches up', async () => {
  const { InProcessNetwork } = await import('../src/network.ts');
  const { Wallet } = await import('../src/client.ts');
  const net = new InProcessNetwork(1, 2);
  const auths = [new Authority('auth-1'), new Authority('auth-2'), new Authority('auth-3'), new Authority('auth-4')];
  const keys = auths.map((a) => a.keys.publicKey);
  auths.forEach((a) => a.setCommittee(keys, QUORUM));
  auths.forEach((a) => net.register(a.name, (m: any) => a.handle(m)));

  const alice = new Wallet('alice', net, auths.map((a) => a.name), QUORUM);
  const bob = generateKeyPair().publicKey;
  auths.forEach((a) => a.fund(alice.address, 500));

  net.setOnline('auth-4', false);              // auth-4 misses the whole payment
  const res = await alice.transfer(bob, 100);
  assert.ok(res.certificate, 'the payment is still final on a 3-of-4 quorum');
  assert.equal(auths[3].balanceOf(bob), 0, 'the offline authority has not applied it yet');

  net.setOnline('auth-4', true);               // it comes back
  await new Promise((r) => setTimeout(r, 1200)); // first background retry is at 500ms

  assert.equal(auths[3].balanceOf(bob), 100, 'the retry healed the lagging authority');
  assert.equal(auths[3].balanceOf(alice.address), 400);
  for (const a of auths) assert.equal(a.balanceOf(bob), 100, `${a.name} agrees`);
});
