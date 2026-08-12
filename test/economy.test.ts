// Smoke test for the resident-economy service. Hermetic: SETU_ECONOMY_TEST=1 makes the module
// skip boot()/listen, so nothing here touches the real authorities, the brain, or a faucet — it is
// offline, $0, and fast. It exists because a crashing endpoint once reset the live market every ~30s
// (a ReferenceError in /health); this asserts the endpoints answer with the right shapes and that a
// bad request can never take the process down (the request handler's try/catch is the backstop —
// remove it and the "survives a malformed request" case fails).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SETU_ECONOMY_TEST = '1';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.SETU_ANTHROPIC_KEY;

const { server } = await import('../packages/setu-economy/economy.ts');
const { MAINNET, SetuWallet } = await import('../packages/setu-pay/index.ts');
// Cache dummy committee keys so verifyCertificate does NOT fetch from the real network during the test.
MAINNET.publicKeys = ['MCowBQYDK2VwAyEA' + 'A'.repeat(28) + '='];

const listen = () => new Promise<string>((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`));
});

test('economy service smoke test (offline, no boot)', async () => {
  const base = await listen();
  try {
    // /health — the endpoint that once crashed the whole process
    const h = await fetch(base + '/health');
    assert.equal(h.status, 200);
    const hb = await h.json();
    assert.equal(hb.ok, true);
    assert.equal(typeof hb.booted, 'boolean');
    assert.equal(typeof hb.ticks, 'number');

    // /state — shape must hold even before boot (empty market)
    const s = await fetch(base + '/state');
    assert.equal(s.status, 200);
    const sb = await s.json();
    assert.ok(sb.brain && typeof sb.brain.budgetUsd === 'number');
    assert.equal(sb.brain.active, false, 'brain must be off with no key');
    assert.ok(sb.totals && typeof sb.totals.transactions === 'number');
    assert.ok(Array.isArray(sb.agents));
    assert.ok(sb.demand && Array.isArray(sb.demand.open) && Array.isArray(sb.demand.delivered));

    // /commission with no certificate -> 400
    const c400 = await fetch(base + '/commission', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
    assert.equal(c400.status, 400);

    // /commission with a well-formed but UNVERIFIABLE certificate -> 402 (payment not verified).
    // Real sender key (valid format) + a zeroed 64-byte signature that cannot verify.
    const w = await SetuWallet.create(MAINNET);
    const fakeSig = Buffer.alloc(64).toString('base64');
    const forged = { order: { sender: w.address, recipient: w.address, amount: 1, seq: 0 }, senderSignature: fakeSig, authoritySignatures: [] };
    const c402 = await fetch(base + '/commission', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ certificate: forged }) });
    assert.equal(c402.status, 402);

    // /demand without a token -> 401 (no SETU_DEMAND_TOKEN set in the test)
    const d401 = await fetch(base + '/demand', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ need: 'x' }) });
    assert.equal(d401.status, 401);

    // /guest-demand with an empty need -> 400 (validated before any network/faucet, so hermetic)
    const g400 = await fetch(base + '/guest-demand', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
    assert.equal(g400.status, 400);

    // Supplier registration makes US call a stranger's URL, so it must never accept an internal one —
    // otherwise it is an SSRF proxy into our own infrastructure. Also reject non-https and bad fields.
    const reg = (body: unknown) => fetch(base + '/supplier/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const payout = 'A'.repeat(60);
    for (const endpoint of [
      'http://example.com/work',            // not https
      'https://localhost/work',
      'https://127.0.0.1/work',
      'https://10.0.0.5/work',
      'https://192.168.1.10/work',
      'https://169.254.169.254/latest/meta-data', // cloud metadata
      'https://[::1]/work',
      'not-a-url',
    ]) {
      const r = await reg({ name: 'probe', service: 'written report', price: 2, endpoint, payout });
      assert.equal(r.status, 400, `endpoint must be refused: ${endpoint}`);
    }
    // an unknown service is refused
    assert.equal((await reg({ name: 'probe', service: 'hacking', price: 2, endpoint: 'https://example.com/w', payout })).status, 400);
    // a well-formed registration is accepted
    const good = await reg({ name: 'probe', service: 'written report', price: 2, endpoint: 'https://example.com/work', payout });
    assert.equal(good.status, 200);
    assert.equal((await good.json()).ok, true);
    // and the same endpoint cannot be registered twice
    assert.equal((await reg({ name: 'probe2', service: 'written report', price: 2, endpoint: 'https://example.com/work', payout })).status, 409);

    // unknown path -> 404
    const nf = await fetch(base + '/bogus');
    assert.equal(nf.status, 404);

    // a malformed body must not crash the process — after it, /health must still answer 200
    await fetch(base + '/commission', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' }).catch(() => {});
    const h2 = await fetch(base + '/health');
    assert.equal(h2.status, 200, 'process must survive a malformed request');

    // A restored wallet must be re-exportable, or the economy's persistence survives only ONE restart
    // then silently falls back to genesis ("key is not extractable"). Round-trip create->export->load->export.
    const w1 = await SetuWallet.create(MAINNET);
    const saved = await w1.export();
    const w2 = await SetuWallet.load(saved, MAINNET);
    const saved2 = await w2.export(); // must NOT throw
    assert.equal(saved2.address, saved.address, 'restored wallet must re-export to the same address');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
