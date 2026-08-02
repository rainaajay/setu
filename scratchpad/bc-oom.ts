// Bean Counter: does the NEW in-memory certificate log turn the unbounded `order.recipient`
// into a remote memory exhaustion of a 256 MB machine? In-process only, fresh Authority.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Authority } from '../src/authority.ts';
import { generateKeyPair, sign, canonical } from '../src/crypto.ts';

const dir = join(process.cwd(), 'scratchpad', 'bc-oom-state');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const keys = [0, 1, 2, 3].map(() => generateKeyPair());
const pub = keys.map((k) => k.publicKey);
const a = new Authority('victim', keys[0], join(dir, 'v.json'));
a.setCommittee(pub, 3);

const sender = generateKeyPair();
a.fund(sender.publicKey, 1_000_000);

const RECIPIENT_BYTES = 100_000; // 100 KB — well under any HTTP body limit, and there is none
const N = 200;
const rss0 = process.memoryUsage().rss;
for (let seq = 0; seq < N; seq++) {
  const recipient = 'R'.repeat(RECIPIENT_BYTES) + seq; // distinct recipient each time
  const order = { sender: sender.publicKey, recipient, amount: 1, seq };
  const bytes = canonical(order);
  const certificate = {
    order,
    senderSignature: sign(sender.privateKey, bytes),
    authoritySignatures: [0, 1, 2].map((i) => ({ authority: pub[i], signature: sign(keys[i].privateKey, bytes) })),
  };
  const r = (await a.handle({ type: 'certificate', certificate })) as { ok: boolean; error?: string };
  if (!r.ok) { console.log(`refused at seq ${seq}: ${r.error}`); break; }
}
const rss1 = process.memoryUsage().rss;
const s = a.stats();
console.log(`settled ${s.settled} certificates carrying a ${RECIPIENT_BYTES / 1000} KB recipient`);
console.log(`RSS grew ${((rss1 - rss0) / 1e6).toFixed(1)} MB for ${N} certificates`);
console.log(`accounts now ${s.accounts} (each oversized recipient also became a persisted account)`);
console.log(`extrapolated to the CERT_LOG_MAX of 20000 entries: ~${(((rss1 - rss0) / N) * 20000 / 1e6).toFixed(0)} MB — the machine has 256 MB`);
rmSync(dir, { recursive: true, force: true });
