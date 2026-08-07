// CFO seat: is "server-enforced delegated budgets — deployment: live" (capabilities.json:17)
// actually true on the LIVE network, or only in-process? Uses my own throwaway addresses and my own
// faucet units. No partial delivery, no fuzzing, no load — one grant, honest payments, one revoke.
import { readFileSync } from 'node:fs';
import { HttpNetwork } from './httpNetwork.ts';
import { Wallet } from './client.ts';
import { generateKeyPair } from './crypto.ts';
import { signAllowance, signRevoke } from './agents/allowance.ts';

const committee = JSON.parse(readFileSync('committee-prod.json', 'utf8')) as {
  quorum: number;
  members: { name: string; url: string; region: string; publicKey: string }[];
};
const peers = Object.fromEntries(committee.members.map((m) => [m.name, m.url]));
const ids = committee.members.map((m) => m.name);
const net = new HttpNetwork(peers);

const principal = generateKeyPair();
const agent = generateKeyPair();
const merchant = generateKeyPair();

await Promise.allSettled(
  committee.members.map((m) =>
    fetch(`${m.url}/admin/fund`, {
      method: 'POST',
      body: JSON.stringify({ address: principal.publicKey, amount: 100 }),
      signal: AbortSignal.timeout(15000),
    }),
  ),
);

const id = 'cfo-probe-' + Date.now();
const signedAllowance = signAllowance(principal, {
  id,
  agent: agent.publicKey,
  maxPerPayment: 5,
  total: 8,
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
});

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return r.json();
}

const reg = await Promise.allSettled(
  committee.members.map(async (m) => `${m.name}:${JSON.stringify(await post(m.url, { type: 'register-delegation', signedAllowance }))}`),
);
console.log('REGISTER:', reg.map((r) => (r.status === 'fulfilled' ? r.value : 'ERR')).join('  '));

const agentWallet = new Wallet('cfo-agent', net, ids, committee.quorum, agent);
let dseq = 0;
async function tryPay(amount: number, label: string) {
  try {
    const { certificate } = await agentWallet.sendOrder(merchant.publicKey, amount, dseq, ids, undefined, id);
    dseq += 1;
    console.log(`${label} (${amount}): SETTLED, ${certificate.authoritySignatures.length} signatures`);
  } catch (e) {
    console.log(`${label} (${amount}): REFUSED -> ${(e as Error).message}`);
  }
}

await tryPay(9, 'A. over per-payment cap 5   ');
await tryPay(4, 'B. within caps              ');
await tryPay(4, 'C. reaches total cap 8      ');
await tryPay(4, 'D. would exceed total cap 8 ');

const signedRevoke = signRevoke(principal, id);
const rev = await Promise.allSettled(
  committee.members.map(async (m) => `${m.name}:${JSON.stringify(await post(m.url, { type: 'revoke-delegation', signedRevoke }))}`),
);
console.log('REVOKE:', rev.map((r) => (r.status === 'fulfilled' ? r.value : 'ERR')).join('  '));
await tryPay(1, 'E. after revocation         ');

for (const m of committee.members) {
  const a = await (await fetch(`${m.url}/account?address=${encodeURIComponent(merchant.publicKey)}`, { signal: AbortSignal.timeout(15000) })).json();
  console.log(`merchant at ${m.name}(${m.region}):`, JSON.stringify(a));
}
