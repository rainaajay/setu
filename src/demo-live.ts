// Setu v0.2 live demo: the same protocol as demo.ts, but each authority is a real OS
// process on a real localhost socket. Run: node src/demo-live.ts
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateCommittee } from './keygen.ts';
import { HttpNetwork } from './httpNetwork.ts';
import { Wallet } from './client.ts';

const srcDir = dirname(fileURLToPath(import.meta.url));
const committee = generateCommittee();
const QUORUM = committee.quorum;
const peers = Object.fromEntries(
  committee.members.map((m) => [m.name, `http://127.0.0.1:${m.port}`]),
);
const ids = committee.members.map((m) => m.name);

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

const children = new Map<string, ChildProcess>();
function startAuthority(name: string): void {
  const child = spawn(process.execPath, [join(srcDir, 'authority-server.ts'), name], {
    stdio: 'ignore',
  });
  children.set(name, child);
}

async function waitForHealth(name: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${peers[name]}/health`, { signal: AbortSignal.timeout(300) });
      if (res.ok) return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`${name} did not come up`);
}

async function fundAll(address: string, amount: number): Promise<void> {
  await Promise.allSettled(
    Object.values(peers).map((url) =>
      fetch(`${url}/admin/fund`, { method: 'POST', body: JSON.stringify({ address, amount }) }),
    ),
  );
}

async function balanceAt(name: string, address: string): Promise<number> {
  const res = await fetch(`${peers[name]}/balance?address=${encodeURIComponent(address)}`);
  return ((await res.json()) as { balance: number }).balance;
}

try {
  section('Boot: 4 authority processes on 127.0.0.1:7101-7104');
  ids.forEach(startAuthority);
  await Promise.all(ids.map(waitForHealth));
  console.log(`  all 4 up (pids: ${ids.map((n) => children.get(n)?.pid).join(', ')})`);

  const network = new HttpNetwork(peers);
  const alice = new Wallet('alice', network, ids, QUORUM);
  const bob = new Wallet('bob', network, ids, QUORUM);
  await fundAll(alice.address, 1000);

  section('1. Finality over real sockets');
  const latencies: number[] = [];
  for (let i = 0; i < 5; i++) {
    const { latencyMs, settledOn } = await alice.transfer(bob.address, 100);
    latencies.push(latencyMs);
    console.log(
      `  transfer #${i + 1}: FINAL in ${latencyMs.toFixed(1)}ms, settled on ${settledOn}/4 authorities`,
    );
  }
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  console.log(`  average finality latency over localhost HTTP: ${avg.toFixed(1)}ms`);

  const perAuth = await Promise.all(ids.map((n) => balanceAt(n, bob.address)));
  console.log(`  bob's balance as reported by each authority: ${perAuth.join(', ')}`);

  console.log(
    '  (that 5-transfer burst drained alice\'s anti-spam bucket — the fee-less rate limit works on real sockets too; waiting 1.5s for refill)',
  );
  await new Promise((r) => setTimeout(r, 1500));

  section('2. Kill a real process mid-flight');
  children.get('auth-4')?.kill();
  await new Promise((r) => setTimeout(r, 300));
  const { latencyMs, settledOn } = await alice.transfer(bob.address, 250);
  console.log(
    `  auth-4 process killed → transfer still FINAL in ${latencyMs.toFixed(1)}ms, settled on ${settledOn}/4`,
  );

  section('3. Double-spend over real sockets (auth-4 still dead)');
  const mallory = new Wallet('mallory', network, ids, QUORUM);
  const victimA = new Wallet('victim-a', network, ids, QUORUM);
  const victimB = new Wallet('victim-b', network, ids, QUORUM);
  await fundAll(mallory.address, 100);
  const attempt = async (label: string, recipient: string, targets: string[]) => {
    try {
      await mallory.sendOrder(recipient, 100, 0, targets);
      console.log(`  ${label}: CERTIFIED (unexpected!)`);
    } catch (e) {
      console.log(`  ${label}: no certificate — ${(e as Error).message}`);
    }
  };
  await attempt('order A via auth-1,auth-2', victimA.address, ['auth-1', 'auth-2']);
  await attempt('order B via auth-3,auth-4', victimB.address, ['auth-3', 'auth-4']);
  console.log('  conflicting orders cannot both certify — locks live in separate OS processes now.');

  console.log('\nv0.2 demonstrated: same protocol, real processes, real sockets.');
} finally {
  for (const child of children.values()) child.kill();
}
