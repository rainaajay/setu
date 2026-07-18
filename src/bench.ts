// Honest throughput benchmark over real localhost sockets. Run: node src/bench.ts
// Spawns its own 4-authority committee on ports 7201-7204 (in-memory, no persistence,
// separate committee file — does not disturb a running devnet). 200 wallets make
// 5 sequential transfers each (inside the per-account rate-limit budget), with all
// wallets running concurrently.
import { spawn, type ChildProcess } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateCommittee } from './keygen.ts';
import { HttpNetwork } from './httpNetwork.ts';
import { Wallet } from './client.ts';
import { generateKeyPair } from './crypto.ts';

const srcDir = dirname(fileURLToPath(import.meta.url));
const benchCommitteePath = join(srcDir, '..', 'committee-bench.json');
const committee = generateCommittee(benchCommitteePath, 7200);
const peers = Object.fromEntries(
  committee.members.map((m) => [m.name, `http://127.0.0.1:${m.port}`]),
);
const ids = committee.members.map((m) => m.name);

const WALLETS = 200;
const TRANSFERS_EACH = 5;

const children: ChildProcess[] = [];
try {
  for (const m of committee.members) {
    children.push(
      spawn(process.execPath, [join(srcDir, 'authority-server.ts'), m.name], {
        stdio: 'ignore',
        env: { ...process.env, SETU_COMMITTEE: benchCommitteePath },
      }),
    );
  }
  for (const m of committee.members) {
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`${peers[m.name]}/health`, { signal: AbortSignal.timeout(300) });
        if (res.ok) break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
  console.log(`4 authorities up; ${WALLETS} wallets × ${TRANSFERS_EACH} transfers each…`);

  const network = new HttpNetwork(peers);
  const sink = generateKeyPair().publicKey;
  const wallets = Array.from(
    { length: WALLETS },
    (_, i) => new Wallet(`w${i}`, network, ids, committee.quorum),
  );

  await Promise.all(
    wallets.map((w) =>
      Promise.all(
        Object.values(peers).map((url) =>
          fetch(`${url}/admin/fund`, {
            method: 'POST',
            body: JSON.stringify({ address: w.address, amount: 1000 }),
          }),
        ),
      ),
    ),
  );
  console.log('funding done, starting timed run');

  const latencies: number[] = [];
  let failures = 0;
  const started = performance.now();
  await Promise.all(
    wallets.map(async (w) => {
      for (let i = 0; i < TRANSFERS_EACH; i++) {
        try {
          const { latencyMs } = await w.transfer(sink, 1);
          latencies.push(latencyMs);
        } catch {
          failures++;
        }
      }
    }),
  );
  const wallSeconds = (performance.now() - started) / 1000;

  latencies.sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.floor((latencies.length - 1) * p)].toFixed(1);
  console.log(`\ncompleted ${latencies.length} transfers (${failures} failed) in ${wallSeconds.toFixed(2)}s`);
  console.log(`throughput: ${(latencies.length / wallSeconds).toFixed(0)} transfers/second`);
  console.log(`finality latency ms — p50: ${pct(0.5)}, p95: ${pct(0.95)}, p99: ${pct(0.99)}`);
  console.log(
    '\ncontext: single-threaded Node authorities, JSON over HTTP, one laptop. FastPay reports 80k TPS with tuned Rust and 20 authorities — that is the ceiling of the architecture, not of this prototype.',
  );
} finally {
  children.forEach((c) => c.kill());
  try {
    unlinkSync(benchCommitteePath);
  } catch {}
}
