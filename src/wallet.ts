// Wallet CLI against a running devnet (node src/devnet.ts) or a deployed committee.
//   node src/wallet.ts new <name>                create a wallet
//   node src/wallet.ts fund <name> <amount>      genesis-fund it on all authorities
//   node src/wallet.ts pay <from> <to> <amount>  transfer (final on quorum certificate)
//   node src/wallet.ts balance <name>            balance + seq as seen by each authority
//   node src/wallet.ts list                      wallets and addresses
// Env: SETU_COMMITTEE to point at a non-default committee file (e.g. the deployed one).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { exportPrivateKey, generateKeyPair, importKeyPair, shortId } from './crypto.ts';
import { HttpNetwork } from './httpNetwork.ts';
import { Wallet } from './client.ts';
import { COMMITTEE_PATH, memberUrl, type CommitteeFile } from './keygen.ts';

const WALLETS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'wallets.json');
const committeePath = process.env.SETU_COMMITTEE ?? COMMITTEE_PATH;
const committee: CommitteeFile = JSON.parse(readFileSync(committeePath, 'utf8'));
const peers = Object.fromEntries(committee.members.map((m) => [m.name, memberUrl(m)]));
const ids = committee.members.map((m) => m.name);
const network = new HttpNetwork(peers);

type WalletsFile = Record<string, { publicKey: string; privateKey: string }>;
const wallets: WalletsFile = existsSync(WALLETS_PATH)
  ? JSON.parse(readFileSync(WALLETS_PATH, 'utf8'))
  : {};

function saveWallets(): void {
  writeFileSync(WALLETS_PATH, JSON.stringify(wallets, null, 2));
}

function resolveAddress(nameOrAddress: string): string {
  return wallets[nameOrAddress]?.publicKey ?? nameOrAddress;
}

async function accountViews(address: string) {
  return Promise.all(
    ids.map(async (id) => {
      try {
        const res = await fetch(`${peers[id]}/account?address=${encodeURIComponent(address)}`, {
          signal: AbortSignal.timeout(5000),
        });
        return { id, ...(await res.json()) as { balance: number; nextSeq: number } };
      } catch {
        return { id, balance: NaN, nextSeq: NaN };
      }
    }),
  );
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'new') {
  const name = args[0];
  if (!name) throw new Error('usage: wallet.ts new <name>');
  if (wallets[name]) throw new Error(`wallet "${name}" already exists`);
  const keys = generateKeyPair();
  wallets[name] = { publicKey: keys.publicKey, privateKey: exportPrivateKey(keys.privateKey) };
  saveWallets();
  console.log(`created wallet "${name}" — address ${shortId(keys.publicKey)}…`);
} else if (cmd === 'list') {
  for (const [name, w] of Object.entries(wallets))
    console.log(`${name}\t${shortId(w.publicKey)}…\t${w.publicKey}`);
} else if (cmd === 'fund') {
  const [name, amountStr] = args;
  const address = resolveAddress(name);
  const amount = Number(amountStr);
  const results = await Promise.allSettled(
    ids.map((id) =>
      fetch(`${peers[id]}/admin/fund`, {
        method: 'POST',
        body: JSON.stringify({ address, amount }),
        signal: AbortSignal.timeout(5000),
      }),
    ),
  );
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  console.log(`funded ${name} with ${amount} on ${ok}/${ids.length} authorities`);
} else if (cmd === 'balance') {
  const address = resolveAddress(args[0]);
  for (const v of await accountViews(address))
    console.log(
      Number.isNaN(v.balance)
        ? `${v.id}\tunreachable`
        : `${v.id}\tbalance=${v.balance}\tnextSeq=${v.nextSeq}`,
    );
} else if (cmd === 'pay') {
  const [from, to, amountStr] = args;
  const w = wallets[from];
  if (!w) throw new Error(`no wallet "${from}" — create it with: wallet.ts new ${from}`);
  const recipient = resolveAddress(to);
  const amount = Number(amountStr);

  // The chain of custody for seq is the network itself: take the highest nextSeq any
  // reachable authority reports (a formed certificate implies a quorum knows it).
  const views = (await accountViews(w.publicKey)).filter((v) => !Number.isNaN(v.nextSeq));
  if (views.length === 0) throw new Error('no authority reachable');
  const seq = Math.max(...views.map((v) => v.nextSeq));

  const wallet = new Wallet(from, network, ids, committee.quorum, importKeyPair(w.publicKey, w.privateKey));
  const { latencyMs, settledOn } = await wallet.sendOrder(recipient, amount, seq, ids);
  console.log(
    `paid ${amount} from ${from} to ${to} — FINAL in ${latencyMs.toFixed(1)}ms, settled on ${settledOn}/${ids.length} authorities`,
  );
} else {
  console.log('usage: wallet.ts new <name> | list | fund <name> <amt> | pay <from> <to> <amt> | balance <name>');
}
