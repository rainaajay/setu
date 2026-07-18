// Proves the browser-wallet code path end-to-end WITHOUT a browser: Node's
// globalThis.crypto.subtle implements the same WebCrypto API, so if this signs orders
// the live authorities accept, the identical code embedded in index.html will too.
// Run: node src/webwallet-test.ts
const subtle = globalThis.crypto.subtle;

// identical to canonical() in crypto.ts — and to the copy embedded in index.html
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)))
      : val,
  );

const b64 = (buf: ArrayBuffer): string => Buffer.from(buf).toString('base64');

const AUTHORITIES = [
  'https://setu-auth-1.fly.dev',
  'https://setu-auth-2.fly.dev',
  'https://setu-auth-3.fly.dev',
  'https://setu-auth-4.fly.dev',
];
const QUORUM = 3;

// 1. create a wallet the way the browser will
const kp = (await subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
const address = b64(await subtle.exportKey('spki', kp.publicKey));
console.log(`webcrypto wallet: ${address.slice(16, 24)}…`);

// 2. faucet
await Promise.all(
  AUTHORITIES.map((url) =>
    fetch(`${url}/admin/fund`, { method: 'POST', body: JSON.stringify({ address, amount: 500 }) }),
  ),
);

// 3. sequence from the network
const infos = await Promise.all(
  AUTHORITIES.map(async (url) => {
    const r = await fetch(`${url}/account?address=${encodeURIComponent(address)}`);
    return (await r.json()) as { balance: number; nextSeq: number };
  }),
);
const seq = Math.max(...infos.map((i) => i.nextSeq));
console.log(`funded; balances ${infos.map((i) => i.balance).join(',')}; seq ${seq}`);

// 4. sign and settle a payment to a throwaway recipient
const sinkKp = (await subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
const recipient = b64(await subtle.exportKey('spki', sinkKp.publicKey));
const order = { sender: address, recipient, amount: 123, seq };
const senderSignature = b64(
  await subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(canonical(order))),
);

const t0 = performance.now();
const responses = await Promise.all(
  AUTHORITIES.map(async (url) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'order', signedOrder: { order, senderSignature } }),
    });
    return (await r.json()) as { ok: boolean; signature?: unknown; error?: string };
  }),
);
const sigs = responses.filter((r) => r.ok).map((r) => r.signature);
if (sigs.length < QUORUM)
  throw new Error(`no quorum: ${responses.map((r) => r.error ?? 'ok').join('; ')}`);
const certificate = { order, senderSignature, authoritySignatures: sigs.slice(0, QUORUM) };
const latency = performance.now() - t0;

const settles = await Promise.all(
  AUTHORITIES.map(async (url) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'certificate', certificate }),
    });
    return (await r.json()) as { ok: boolean };
  }),
);
console.log(
  `payment FINAL in ${latency.toFixed(0)}ms, settled on ${settles.filter((s) => s.ok).length}/4 — WebCrypto signatures are wire-compatible with the live network`,
);
