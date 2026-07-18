// Setu Credits: a closed-loop, operator-issued, service-redeemable credit with a fixed,
// auditable supply — the concrete answer to "what is being settled?" (white paper §6-§7).
// Every Credit traces to the Treasury; nothing is minted from nowhere. See CREDITS.md.
// Run: node src/demo-issuer.ts
import { Authority } from './authority.ts';
import { Wallet } from './client.ts';
import { InProcessNetwork } from './network.ts';
import { generateKeyPair, shortId } from './crypto.ts';
import { Issuer } from './issuer.ts';

const QUORUM = 3;
const SUPPLY = 1_000_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function section(t: string) { console.log(`\n=== ${t} ===`); }

const network = new InProcessNetwork();
const authorities = [1, 2, 3, 4].map((i) => new Authority(`auth-${i}`));
const committee = authorities.map((a) => a.keys.publicKey);
for (const a of authorities) { a.setCommittee(committee, QUORUM); network.register(a.name, a.handle); }
const ids = authorities.map((a) => a.name);

// Genesis: the ENTIRE supply is created once, in the Treasury. After this, no minting.
const issuer = new Issuer(network, ids, QUORUM, SUPPLY);
authorities.forEach((a) => a.fund(issuer.address, SUPPLY));
console.log(`Treasury (issuer) ${shortId(issuer.address)}… created with a fixed supply of ${SUPPLY.toLocaleString()} Credits.`);

const bal = (addr: string) => authorities[0].balanceOf(addr);
const circulating = () => SUPPLY - bal(issuer.address);

section('1. Issuance — a Credit is a real transfer out of the Treasury (provenance)');
const alice = new Wallet('alice', network, ids, QUORUM, generateKeyPair());
const bob = new Wallet('bob', network, ids, QUORUM, generateKeyPair());
await issuer.issue(alice.address, 100);
await issuer.issue(bob.address, 50);
console.log(`  issued 100 to alice, 50 to bob. Every Credit they hold came from the Treasury.`);
console.log(`  Treasury ${bal(issuer.address).toLocaleString()}, alice ${bal(alice.address)}, bob ${bal(bob.address)}`);

section('2. Circulation — Credits change hands for services in the economy');
await sleep(600);
await alice.transfer(bob.address, 30); // alice buys a service from bob
console.log(`  alice paid bob 30 for a service. alice ${bal(alice.address)}, bob ${bal(bob.address)}`);

section('3. Redemption — a holder returns Credits to the Treasury (closes the loop)');
await sleep(600);
await bob.transfer(issuer.address, 40);
console.log(`  bob returned 40 to the Treasury. bob ${bal(bob.address)}, Treasury ${bal(issuer.address).toLocaleString()}`);

section('4. Supply accounting — fixed and conserved, nothing minted from nowhere');
const held = bal(issuer.address) + bal(alice.address) + bal(bob.address);
console.log(`  fixed supply:      ${SUPPLY.toLocaleString()}`);
console.log(`  in Treasury:       ${bal(issuer.address).toLocaleString()}`);
console.log(`  circulating:       ${circulating()}`);
console.log(`  sum of all holdings: ${held.toLocaleString()}  (equals supply: ${held === SUPPLY})`);

console.log(`\nWhat a Credit IS: a closed-loop credit, issued by the named Treasury, redeemable only`);
console.log(`for services inside the Setu economy — not money, not a fiat claim. Full terms: CREDITS.md.`);
console.log(`This is the honest closed-loop anchoring; a regulated-money variant is white paper §7.`);
