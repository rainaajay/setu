// TARA CYCLE-10 REPRO (in-process, deterministic — NOT run against live).
// Claim under test: commit 8d7e8c1 "Build authority-to-authority anti-entropy (the top release
// blocker)" makes a diverged authority converge.
// Reality: the certificate log (authority.ts:78) is IN-MEMORY ONLY — persist() (:129-143) writes
// {accounts, delegations} and nothing else. After ANY peer restart the log is empty, certsFor()
// (:207-215) breaks at the first missing seq, and the laggard can never converge — not even for
// NEW certificates from that sender, because replay is ordered.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Authority } from '../src/authority.ts';
import { generateKeyPair, sign, canonical } from '../src/crypto.ts';

const QUORUM = 3;
const dir = mkdtempSync(join(tmpdir(), 'setu-tara-'));
const mk = (n) => new Authority(n, undefined, join(dir, n + '.json'));
let auths = [mk('auth-1'), mk('auth-2'), mk('auth-3'), mk('auth-4')];
const keys = auths.map((a) => a.keys.publicKey);
auths.forEach((a) => a.setCommittee(keys, QUORUM));

const alice = generateKeyPair();
const bob = generateKeyPair().publicKey;
auths.forEach((a) => a.fund(alice.publicKey, 500));

const lagging = auths[0];
let healthy = auths.slice(1);

// Three payments certify with a full quorum but reach only the healthy three.
for (let seq = 0; seq < 3; seq++) {
  const order = { sender: alice.publicKey, recipient: bob, amount: 20, seq };
  const signed = { order, senderSignature: sign(alice.privateKey, canonical(order)) };
  const res = await Promise.all(auths.map((a) => a.handle({ type: 'order', signedOrder: signed })));
  const sigs = res.filter((r) => r && r.ok).map((r) => r.signature);
  assert.ok(sigs.length >= QUORUM);
  const cert = { order, senderSignature: signed.senderSignature, authoritySignatures: sigs.slice(0, QUORUM) };
  await Promise.all(healthy.map((a) => a.handle({ type: 'certificate', certificate: cert })));
}
assert.equal(lagging.balanceOf(bob), 0, 'laggard silently wrong');
assert.equal(healthy[0].balanceOf(bob), 60);

// --- THE ONLY DIFFERENCE FROM THE SHIPPED TEST: the peer restarts (a Fly deploy, an OOM, a
// machine move). It reloads accounts+delegations from disk. The certificate log is not on disk.
const restarted = new Authority('auth-2', healthy[0].keys, join(dir, 'auth-2.json'));
restarted.setCommittee(keys, QUORUM);
assert.equal(restarted.balanceOf(bob), 60, 'ledger state survived the restart, as designed');

// Exactly the reconcile loop of authority-server.ts syncOnce() (:173-202).
const peerDigest = restarted.digest();
assert.ok(peerDigest.find((d) => d.sender === alice.publicKey)?.nextSeq === 3,
  'the digest still advertises seq 3 — the peer LOOKS able to help');
let applied = 0;
for (const { sender, nextSeq } of peerDigest) {
  const from = lagging.accountInfo(sender).nextSeq;
  if (from >= nextSeq) continue;
  const certs = restarted.certsFor(sender, from, nextSeq);
  for (const certificate of certs) {
    const r = await lagging.handle({ type: 'certificate', certificate });
    if (!r?.ok) break;
    applied++;
  }
}
console.log('certificates recovered after a peer restart:', applied);
assert.equal(applied, 0, 'REPRO: nothing is recovered');
assert.equal(lagging.balanceOf(bob), 0, 'REPRO: the laggard is still silently wrong, permanently');

// And it is now stuck for that sender FOREVER: a NEW payment cannot be applied either, because
// replay is ordered and seq 0-2 can never be served again.
const order = { sender: alice.publicKey, recipient: bob, amount: 20, seq: 3 };
const signed = { order, senderSignature: sign(alice.privateKey, canonical(order)) };
const res = await Promise.all(healthy.map((a) => a.handle({ type: 'order', signedOrder: signed })));
const sigs = res.filter((r) => r && r.ok).map((r) => r.signature);
const cert = { order, senderSignature: signed.senderSignature, authoritySignatures: sigs.slice(0, QUORUM) };
const r = await lagging.handle({ type: 'certificate', certificate: cert });
console.log('new certificate applied to the laggard?', r);
assert.equal(r.ok, false);
assert.equal(r.error, 'sequence gap (authority behind)');
console.log('\nREPRO CONFIRMED: after a peer restart, anti-entropy recovers 0 certificates and the');
console.log('lagging authority is permanently below quorum-usefulness for that sender.');
rmSync(dir, { recursive: true, force: true });
