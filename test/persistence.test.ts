// Persistence & recovery tests (brief §20). Crash-safe atomic writes, corrupt-file fallback,
// the safety-critical pending lock surviving a restart, and a lagging authority catching up
// from a certificate it never saw the order for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Authority } from '../src/authority.ts';
import { generateKeyPair, sign, canonical, type KeyPair } from '../src/crypto.ts';
import type { TransferOrder, SignedOrder, Certificate } from '../src/types.ts';

const QUORUM = 3;
const tempDir = () => mkdtempSync(join(tmpdir(), 'setu-persist-'));
const signOrder = (k: KeyPair, order: TransferOrder): SignedOrder => ({ order, senderSignature: sign(k.privateKey, canonical(order)) });

function committee(dir?: string) {
  const auths = [1, 2, 3, 4].map((i) => new Authority(`auth-${i}`, undefined, dir ? join(dir, `auth-${i}.json`) : undefined));
  const keys = auths.map((a) => a.keys.publicKey);
  auths.forEach((a) => a.setCommittee(keys, QUORUM));
  return { auths, keys };
}

test('persist writes atomically and keeps a one-generation backup', () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'auth-1.json');
    const a = new Authority('auth-1', undefined, file);
    const alice = generateKeyPair();
    a.fund(alice.publicKey, 100); // first write — no backup yet
    assert.equal(existsSync(file), true);
    assert.equal(existsSync(file + '.tmp'), false); // temp cleaned up by rename
    JSON.parse(readFileSync(file, 'utf8')); // valid JSON, not half-written
    a.fund(alice.publicKey, 50); // second write — backup now exists
    assert.equal(existsSync(file + '.bak'), true);
    assert.equal(a.balanceOf(alice.publicKey), 150);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a corrupt primary state file is recovered from the backup', () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'auth-1.json');
    const a = new Authority('auth-1', undefined, file);
    const alice = generateKeyPair();
    a.fund(alice.publicKey, 100); // writes primary
    a.fund(alice.publicKey, 40);  // primary=140, backup=100
    // Corrupt the primary as an interrupted write would.
    writeFileSync(file, '{ this is not valid json');
    const reloaded = new Authority('auth-1', undefined, file);
    assert.equal(reloaded.balanceOf(alice.publicKey), 100); // fell back to the backup generation
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an authority refuses to start if all state copies are unreadable (no silent amnesia)', () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'auth-1.json');
    writeFileSync(file, 'garbage');
    writeFileSync(file + '.bak', 'also garbage');
    assert.throws(() => new Authority('auth-1', undefined, file), /refusing to start/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the safety-critical pending lock survives a restart — a conflicting order is still refused', async () => {
  const dir = tempDir();
  try {
    const file = join(dir, 'auth-1.json');
    const a1 = new Authority('auth-1', undefined, file);
    a1.setCommittee([a1.keys.publicKey], 1);
    const alice = generateKeyPair(), bob = generateKeyPair(), carol = generateKeyPair();
    a1.fund(alice.publicKey, 50);
    // Submit an order — this locks (sender, seq 0) as pending and persists the lock.
    const first = signOrder(alice, { sender: alice.publicKey, recipient: bob.publicKey, amount: 50, seq: 0 });
    const r1 = (await a1.handle({ type: 'order', signedOrder: first })) as any;
    assert.equal(r1.ok, true);
    // Restart the authority from disk (new process, same file).
    const restarted = new Authority('auth-1', undefined, file);
    restarted.setCommittee([restarted.keys.publicKey], 1);
    // A conflicting order at the same sequence must still be refused after the restart.
    const conflicting = signOrder(alice, { sender: alice.publicKey, recipient: carol.publicKey, amount: 50, seq: 0 });
    const r2 = (await restarted.handle({ type: 'order', signedOrder: conflicting })) as any;
    assert.equal(r2.ok, false);
    assert.match(r2.error, /conflicting order pending/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a lagging authority that never saw the order still settles from the certificate (catch-up)', async () => {
  const { auths, keys } = committee();
  const alice = generateKeyPair(), bob = generateKeyPair();
  auths.forEach((a) => a.fund(alice.publicKey, 100));

  // Form a certificate using only the first three authorities — the fourth is "offline".
  const order: TransferOrder = { sender: alice.publicKey, recipient: bob.publicKey, amount: 30, seq: 0 };
  const signed = signOrder(alice, order);
  const online = auths.slice(0, 3);
  const sigs = ((await Promise.all(online.map((a) => a.handle({ type: 'order', signedOrder: signed })))) as any[]).filter((r) => r.ok).map((r) => r.signature);
  assert.equal(sigs.length, 3);
  const cert: Certificate = { order, senderSignature: signed.senderSignature, authoritySignatures: sigs };

  // The lagging fourth authority applies the certificate despite never seeing the order.
  const lagging = auths[3];
  assert.equal(lagging.balanceOf(bob.publicKey), 0);
  const settle = (await lagging.handle({ type: 'certificate', certificate: cert })) as any;
  assert.equal(settle.ok, true);
  assert.equal(lagging.balanceOf(alice.publicKey), 70);
  assert.equal(lagging.balanceOf(bob.publicKey), 30);
});
