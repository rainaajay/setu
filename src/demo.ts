// Setu v0 demo — proves the five claims in SPEC.md §"v0 prototype scope":
//   1. one-round-trip finality with measured latency
//   2. settlement survives 1 of 4 authorities down
//   3. a client equivocating (double-spend) can never form a certificate
//   4. a Byzantine authority signing everything still cannot enable a double-spend
//   5. spam is throttled per-account with no fees
import { Authority, EquivocatingAuthority } from './authority.ts';
import { Wallet } from './client.ts';
import { InProcessNetwork } from './network.ts';
import { shortId } from './crypto.ts';

const QUORUM = 3; // 2f+1 with f=1 of 4 authorities Byzantine/faulty

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

function setup(byzantine = false) {
  const network = new InProcessNetwork();
  const authorities = [
    byzantine ? new EquivocatingAuthority('auth-1*') : new Authority('auth-1'),
    new Authority('auth-2'),
    new Authority('auth-3'),
    new Authority('auth-4'),
  ];
  const committee = authorities.map((a) => a.keys.publicKey);
  for (const a of authorities) {
    a.setCommittee(committee, QUORUM);
    network.register(a.name, a.handle);
  }
  const ids = authorities.map((a) => a.name);
  const fundAll = (address: string, amount: number) =>
    authorities.forEach((a) => a.fund(address, amount));
  return { network, authorities, ids, fundAll };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- 1. Happy path: one-round-trip finality ---------------------------------------
{
  section('1. Finality in one round trip (4 authorities, quorum 3)');
  const { network, authorities, ids, fundAll } = setup();
  const alice = new Wallet('alice', network, ids, QUORUM);
  const bob = new Wallet('bob', network, ids, QUORUM);
  fundAll(alice.address, 1000);

  const latencies: number[] = [];
  for (let i = 0; i < 5; i++) {
    const { latencyMs, settledOn } = await alice.transfer(bob.address, 100);
    latencies.push(latencyMs);
    console.log(
      `  transfer #${i + 1}: FINAL in ${latencyMs.toFixed(1)}ms (certificate formed), settled on ${settledOn}/4 authorities`,
    );
  }
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  console.log(`  average finality latency: ${avg.toFixed(1)}ms — no blocks, no mempool, no fees`);
  console.log(
    `  balances per authority (alice, bob): ${authorities
      .map((a) => `${a.name}=(${a.balanceOf(alice.address)}, ${a.balanceOf(bob.address)})`)
      .join('  ')}`,
  );
}

// --- 2. One authority down --------------------------------------------------------
{
  section('2. Liveness with 1 of 4 authorities offline');
  const { network, ids, fundAll } = setup();
  const alice = new Wallet('alice', network, ids, QUORUM);
  const bob = new Wallet('bob', network, ids, QUORUM);
  fundAll(alice.address, 1000);

  network.setOnline('auth-4', false);
  const { latencyMs, settledOn } = await alice.transfer(bob.address, 250);
  console.log(
    `  auth-4 offline → transfer still FINAL in ${latencyMs.toFixed(1)}ms, settled on ${settledOn}/4 (auth-4 catches up via the certificate whenever it returns)`,
  );
}

// --- 3. Client double-spend -------------------------------------------------------
{
  section('3. Double-spend: mallory sends conflicting orders to disjoint authority halves');
  const { network, ids, fundAll } = setup();
  const mallory = new Wallet('mallory', network, ids, QUORUM);
  const victimA = new Wallet('victim-a', network, ids, QUORUM);
  const victimB = new Wallet('victim-b', network, ids, QUORUM);
  fundAll(mallory.address, 100);

  const attempt = async (label: string, recipient: string, targets: string[]) => {
    try {
      await mallory.sendOrder(recipient, 100, 0, targets);
      console.log(`  ${label}: CERTIFIED (unexpected!)`);
    } catch (e) {
      console.log(`  ${label}: no certificate — ${(e as Error).message}`);
    }
  };
  await attempt('order A (100 → victim-a) via auth-1,auth-2', victimA.address, ['auth-1', 'auth-2']);
  await attempt('order B (100 → victim-b) via auth-3,auth-4', victimB.address, ['auth-3', 'auth-4']);
  await attempt('retry A against auth-3,auth-4 (locked on B)', victimA.address, ['auth-3', 'auth-4']);
  console.log(
    '  neither conflicting order can reach quorum 3: honest authorities lock first-seen.',
  );
  console.log(
    '  mallory\'s own account is now frozen at seq 0 — equivocation only hurts the equivocator.',
  );
}

// --- 4. Byzantine authority -------------------------------------------------------
{
  section('4. Byzantine authority: auth-1* signs everything, keeps no locks');
  const { network, ids, fundAll } = setup(true);
  const mallory = new Wallet('mallory', network, ids, QUORUM);
  const victimA = new Wallet('victim-a', network, ids, QUORUM);
  const victimB = new Wallet('victim-b', network, ids, QUORUM);
  fundAll(mallory.address, 100);

  const a = await mallory.sendOrder(victimA.address, 100, 0, ['auth-1*', 'auth-2', 'auth-4']);
  console.log(
    `  order A certified with sigs from auth-1*,auth-2,auth-4 — FINAL in ${a.latencyMs.toFixed(1)}ms (legitimate: only ONE order certified)`,
  );
  try {
    await mallory.sendOrder(victimB.address, 100, 0, ids);
    console.log('  order B: CERTIFIED (unexpected — double spend!)');
  } catch (e) {
    console.log(`  order B (same seq, all 4 authorities): no certificate — ${(e as Error).message}`);
  }
  console.log(
    '  even with auth-1* signing both orders, a second quorum is impossible: it would need 2 honest signers who already settled A.',
  );
}

// --- 5. Spam without fees ---------------------------------------------------------
{
  section('5. Anti-spam without fees: per-account rate limit (bucket: 5, refill 2/s)');
  const { network, ids, fundAll } = setup();
  const eve = new Wallet('eve', network, ids, QUORUM);
  const target = new Wallet('target', network, ids, QUORUM);
  fundAll(eve.address, 10_000);

  let accepted = 0;
  let rejected = 0;
  for (let i = 0; i < 12; i++) {
    try {
      await eve.transfer(target.address, 1);
      accepted++;
    } catch {
      rejected++;
    }
  }
  console.log(`  burst of 12 transfers: ${accepted} accepted, ${rejected} rate-limited`);
  await sleep(1500);
  const { latencyMs } = await eve.transfer(target.address, 1);
  console.log(
    `  after 1.5s the bucket refilled: next transfer FINAL in ${latencyMs.toFixed(1)}ms — throttling without a fee market`,
  );
}

console.log('\nAll five SPEC.md v0 claims demonstrated.');
console.log(`(addresses are ed25519 public keys, e.g. wallet "${shortId(new Wallet('x', new InProcessNetwork(), [], 0).address)}…")`);
