// Bean Counter cycle-10 bench: persist() cost vs account count, catch-up round block time,
// and cert-log memory footprint. In-process only — never touches the live network.
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Authority } from '../src/authority.ts';
import { generateKeyPair, sign, canonical } from '../src/crypto.ts';

const dir = join(process.cwd(), 'scratchpad', 'bc-state');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

// ---------- 1. persist() cost vs account count ----------
// fund() is one persist() call. Time a single fund at increasing account counts.
const a = new Authority('bench', generateKeyPair(), join(dir, 'bench.json'));
const addrs: string[] = [];
function newAddr() { const k = generateKeyPair(); addrs.push(k.publicKey); return k; }

// Windows AV can transiently EPERM the atomic rename; retry so the bench is about cost, not the OS.
function retry(f: () => void) {
  for (let i = 0; i < 50; i++) { try { f(); return; } catch { /* spin */ } }
  f();
}

const marks = [800, 2000, 5000, 10000, 20000, 40000];
let n = 0;
const probe = generateKeyPair();
retry(() => a.fund(probe.publicKey, 1));
console.log('accounts, persist_ms(median of 21), state_bytes');
for (const m of marks) {
  while (n < m) { const p = newAddr().publicKey; retry(() => a.fund(p, 1000)); n++; }
  const t: number[] = [];
  for (let i = 0; i < 21; i++) { const s = performance.now(); retry(() => a.fund(probe.publicKey, 1)); t.push(performance.now() - s); }
  t.sort((x, y) => x - y);
  console.log(`${m}, ${t[10].toFixed(2)}, ${statSync(join(dir, 'bench.json')).size}`);
}

// ---------- 2. catch-up round: how long does applying K certificates block? ----------
// Build a real 4-authority committee, settle a chain of payments on 3 of them, then measure how
// long the 4th takes to apply the backlog through handle() — the exact anti-entropy path.
const dir2 = join(dir, 'quorum');
mkdirSync(dir2, { recursive: true });
const keys = [0, 1, 2, 3].map(() => generateKeyPair());
const auths = keys.map((k, i) => new Authority(`a${i}`, k, join(dir2, `a${i}.json`)));
const pub = keys.map((k) => k.publicKey);
for (const x of auths) x.setCommittee(pub, 3);

const sender = generateKeyPair();
const recip = generateKeyPair();
// Give the lagging authority (index 3) the same starting state so divergence is purely missed certs.
for (const x of auths) x.fund(sender.publicKey, 200_000);
// pad the lagging authority's account map to a realistic size
for (let i = 0; i < 800; i++) auths[3].fund(generateKeyPair().publicKey, 10);

const CERTS = 400;
const certs: unknown[] = [];
for (let seq = 0; seq < CERTS; seq++) {
  const order = { sender: sender.publicKey, recipient: recip.publicKey, amount: 1, seq };
  const bytes = canonical(order);
  // Build the quorum certificate directly from the authorities' own keys. This is exactly the
  // object handleCertificate verifies; going through handleOrder would hit the per-sender token
  // bucket (capacity 5, 2/s) and cap the bench at the anti-spam rate rather than the persist cost.
  const sigs = [0, 1, 2].map((i) => ({ authority: pub[i], signature: sign(keys[i].privateKey, bytes) }));
  const certificate = { order, senderSignature: sign(sender.privateKey, bytes), authoritySignatures: sigs };
  for (let i = 0; i < 3; i++) {
    const rr = (await auths[i].handle({ type: 'certificate', certificate })) as { ok: boolean; error?: string };
    if (seq === 0 && !rr.ok) console.log('settle err', rr.error);
  }
  certs.push(certificate);
}

const t0 = performance.now();
let applied = 0;
for (const certificate of certs) {
  const r = (await auths[3].handle({ type: 'certificate', certificate })) as { ok: boolean; error?: string };
  if (!r.ok) { console.log('lagging apply stopped:', r.error); break; }
  applied++;
}
const elapsed = performance.now() - t0;
console.log(`\ncatch-up: applied ${applied}/${CERTS} certificates in ${elapsed.toFixed(0)} ms (${(elapsed / applied).toFixed(2)} ms each) at ~800 accounts`);
console.log(`projected block for a full round (25 senders x 200 certs = 5000): ${((elapsed / applied) * 5000 / 1000).toFixed(1)} s`);

// ---------- 3. cert-log memory ----------
const one = JSON.stringify(certs[0]);
console.log(`\none certificate serialises to ${one.length} bytes; CERT_LOG_MAX 20000 => ~${(one.length * 20000 / 1e6).toFixed(1)} MB serialised`);
const before = process.memoryUsage().heapUsed;
const m = new Map<string, unknown>();
for (let i = 0; i < 20000; i++) m.set(`k${i}`, JSON.parse(one));
global.gc?.();
const after = process.memoryUsage().heapUsed;
console.log(`20000 parsed certificates in a Map: heapUsed +${((after - before) / 1e6).toFixed(1)} MB (machine memory = 256 MB)`);

rmSync(dir, { recursive: true, force: true });
