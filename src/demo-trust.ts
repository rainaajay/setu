// Setu v0.3 demo — Plane 2, the trust/data layer. No committee, no quorum, no server:
// peers gossip signed ops in a hash-DAG and converge. Proves:
//   1. identities + attestations replicate P2P and converge (matching fingerprints)
//   2. offline peer catches up on reconnect (local-first)
//   3. forged attestation (wrong signature) rejected by every honest peer
//   4. tampered op rejected (content addressing)
//   5. equivocating peer cannot split the network — all peers converge to ONE state
//   6. revocation: only the original attester can revoke, and it converges
import { TrustPeer } from './trust/peer.ts';
import { makeOp } from './trust/op.ts';
import { shortId } from './crypto.ts';

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

const alice = new TrustPeer('alice');
const bob = new TrustPeer('bob');
const carol = new TrustPeer('carol');
const peers = [alice, bob, carol];

const gossip = () => {
  // two rounds of pairwise anti-entropy ≈ full propagation for 3 peers
  for (let i = 0; i < 2; i++) {
    alice.syncWith(bob);
    bob.syncWith(carol);
    carol.syncWith(alice);
  }
};
const fingerprints = () => peers.map((p) => `${p.name}=${p.fingerprint()}`).join('  ');

section('1. Identity + attestation, fully P2P');
alice.createOp('profile', { field: 'name', value: 'Alice' });
alice.createOp('profile', { field: 'org', value: 'Acme Capital' });
const bobsAttestation = bob.createOp('attest', {
  subject: alice.address,
  claim: 'KYC-verified 2026-07-16',
});
carol.createOp('attest', { subject: alice.address, claim: 'known counterparty since 2024' });
gossip();
console.log(`  fingerprints after gossip: ${fingerprints()}`);
console.log(
  `  attestations about alice (as seen by carol): ${carol
    .attestationsAbout(alice.address)
    .map((a) => `"${a.claim}" from ${shortId(a.from)}…`)
    .join('; ')}`,
);

section('2. Local-first: carol goes offline, world moves on, she reconnects');
alice.createOp('profile', { field: 'role', value: 'Risk Partner' });
bob.createOp('attest', { subject: alice.address, claim: 'board-approved signatory' });
alice.syncWith(bob); // carol not involved — she is "offline"
console.log(`  while carol is offline: ${fingerprints()} (carol behind)`);
carol.syncWith(bob); // reconnect
console.log(`  after carol reconnects:  ${fingerprints()}`);

section('3. Forgery: mallory authors an op claiming to be alice');
const mallory = new TrustPeer('mallory');
const forged = makeOp(
  mallory.keys,
  'attest',
  { subject: mallory.address, claim: 'trusted by everyone' },
  [],
);
(forged.body as { author: string }).author = alice.address; // lie about authorship
const verdictF = bob.receive([forged]);
console.log(`  bob's verdict: accepted=${verdictF.accepted}, rejected: ${verdictF.rejected[0]}`);

section('4. Tampering: mallory relays a real op with an edited payload');
const tampered = structuredClone(bobsAttestation);
tampered.body.payload.claim = 'KYC-verified AND creditworthy to £10m';
const verdictT = carol.receive([tampered]);
console.log(`  carol's verdict: accepted=${verdictT.accepted}, rejected: ${verdictT.rejected[0]}`);

section('5. Equivocation: mallory tells alice one thing and bob another');
// mallory joins the network legitimately, then issues two CONCURRENT conflicting ops
// (same deps) and sends one to alice only, the other to bob only.
alice.syncWith(mallory);
const depsAtSplit = mallory.heads();
// both ops built on identical deps → concurrent branches of the DAG
const faceA = makeOp(mallory.keys, 'profile', { field: 'status', value: 'solvent' }, depsAtSplit);
const faceB = makeOp(mallory.keys, 'profile', { field: 'status', value: 'regulated' }, depsAtSplit);
alice.receive([faceA]);
bob.receive([faceB]);
console.log(`  before gossip: ${fingerprints()} (alice and bob see different mallories)`);
gossip();
const status = alice.deriveState().profiles[mallory.address]?.status;
console.log(`  after gossip:  ${fingerprints()}`);
console.log(
  `  every peer resolves mallory.status to the SAME value ("${status}") — equivocation cannot split the network, and both ops remain in the DAG as evidence.`,
);

section('6. Revocation: only the original attester can revoke');
const targetHash = Object.keys(bob.deriveState().attestations).find(
  (h) => bob.deriveState().attestations[h].claim === 'KYC-verified 2026-07-16',
)!;
// an outsider trying to revoke bob's attestation: op is accepted into the DAG (validly
// signed) but the derivation rule ignores it — only the attester's revoke counts
const outsider = new TrustPeer('outsider');
outsider.syncWith(bob);
outsider.createOp('revoke', { target: targetHash });
outsider.syncWith(bob);
const before = carol.attestationsAbout(alice.address).length;
const stillThere = Object.keys(bob.deriveState().attestations).includes(targetHash);
console.log(`  outsider's revoke of bob's attestation: ignored (attestation still present: ${stillThere})`);
bob.createOp('revoke', { target: targetHash });
gossip();
const after = carol.attestationsAbout(alice.address).length;
console.log(
  `  attestations about alice seen by carol: ${before} → ${after} (bob's own revocation propagated; convergent: ${fingerprints()})`,
);

console.log('\nPlane 2 demonstrated: committee-less, server-less, Byzantine-tolerant trust layer.');
console.log('Same key space as Plane 1 — a wallet address IS an identity that can be attested.');
