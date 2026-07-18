# Setu — a post-blockchain value & trust system

*Design spec v0.1 — 2026-07-15. Working name "Setu" (Sanskrit: bridge). Grounded in the
deep-research findings of 2026-07-15; every design choice below cites the verified claim
it rests on.*

## Thesis

Blockchain's core mistake was forcing every transaction on Earth into one totally-ordered
sequence. Total ordering is what makes blockchains slow, fee-bearing, MEV-extractable and
energy-hungry. **Payments do not need total ordering.** A transfer only conflicts with
other spends from the *same account* — so per-account sequencing plus Byzantine consistent
broadcast is sufficient for safety, and it settles in one network round trip.

Evidence base (all adversarially verified 3-0 unless noted):

- FastPay (arXiv:2003.11506): BFT settlement **without consensus** — 80,000+ TPS with 20
  authorities, sub-100ms finality, using Byzantine Consistent Broadcast.
- pod (arXiv:2501.14931): one-round-trip (2δ) confirmation is *physically optimal*; total
  ordering in one round trip is impossible per known lower bounds — so don't demand it.
- ABC (arXiv:1909.10926): permissionless, fully asynchronous ledger with no PoW, no
  randomness, no consensus — but **no general smart contracts**. We accept that trade
  deliberately: it deletes MEV, fee auctions and token speculation by construction.
- IOTA post-mortem (MDPI 1424-8220/25/11/3408): the feeless-DAG flagship was abandoned
  after 7 years, then relaunched *with* fees and a 150-validator DPoS committee. Lesson:
  feeless failed **economically** (nothing priced spam), not technically. Anti-spam must
  be designed in without fees: rate-limited identities, not gas.
- Avalanche (arXiv:2210.03423): partial ordering is fine (we use it too), but its
  probabilistic sampling admits a cheap liveness attack. Quorum certificates — explicit
  2f+1 signatures — do not have this failure mode.
- Narwhal/Bullshark (github.com/MystenLabs/narwhal): where ordering *is* someday needed,
  decouple data dissemination from ordering. Out of scope for v0.
- Local-first + BFT-CRDTs (Ink & Switch; Kleppmann PaPoC'22): the trust/data plane
  (identity, attestations, records) needs no committee at all — op-based CRDTs tolerate
  unlimited Byzantine nodes. *Verified against the paper 2026-07-16, with two
  qualifications that our two-plane split already respects:* (1) BFT-CRDTs give eventual
  consistency only — explicitly **not** suitable for payments/global consensus, which is
  why Plane 1 exists; (2) "Sybil-immune" assumes signed operations over authenticated
  identities (hash graphs + signatures), not anonymous free-for-all — Setu's
  keys-as-identities model satisfies this.

## Architecture: two planes

**Plane 1 — Settlement (money).** This prototype. A small committee of authorities
(v0: 4, quorum 3; production: 10–20, rotating) countersigns transfer orders. A transfer
with a quorum certificate is **final** — one round trip, no blocks, no mempool, no fees.
Authorities are funded by membership/service economics (the card-network model without
the monopoly rent), never per-transaction commission.

**Plane 2 — Trust/data (identity, attestations, records).** BFT-CRDTs on a local-first
substrate; fully P2P, no committee, works offline, merges on reconnect. Future phase.

**Cross-cutting:** ZK proofs for selective disclosure (Phase 3); post-quantum-swappable
crypto abstraction from day one (`crypto.ts` is the single seam); libp2p as the eventual
network layer (v0 uses an in-process network behind the same interface).

## Plane 1 protocol (FastPay model)

State per account: `balance`, `nextSeq`, optional `pending` order.

1. **Order.** Sender signs `TransferOrder{sender, recipient, amount, seq}` where
   `seq == nextSeq`, and broadcasts it to all authorities.
2. **Countersign.** Each honest authority checks: valid signature, `seq` matches,
   sufficient balance (minus any pending), no *conflicting* pending order at this seq,
   and the per-account **rate limit** (anti-spam without fees). If ok it records the
   order as pending — locking the funds — and returns its signature. Re-signing the
   *same* order is idempotent (safe under retries).
3. **Certificate.** The sender collects **quorum = 2f+1** signatures (3 of 4 here,
   tolerating f=1 Byzantine authority) into a `Certificate`. **This is finality** — no
   quorum can ever form for a conflicting order at the same seq, because honest
   authorities lock on first-seen. (Certificate formation, not full propagation, is the
   finality event — same as FastPay.)
4. **Settle.** The certificate is broadcast; each authority verifies the quorum
   signatures, debits the sender, credits the recipient, bumps `nextSeq`, clears pending.
   Authorities that missed the order phase still settle on certificate receipt (catch-up).

Safety argument: two conflicting orders at the same `(sender, seq)` would each need 2f+1
signatures from 3f+1 authorities → some honest authority signed both → contradiction with
first-seen locking. Liveness: the sender retries against ≥2f+1 reachable authorities; no
timing assumptions needed for safety.

Consciously given up: general smart contracts (verified impossible without consensus),
a speculative native token, and global total ordering.

## The agent thesis (2026-07-17)

Setu's market is not human payments — it is the **agent economy**. Humans tolerate card
fees and T+1; agents cannot: an agent buying thousands of API responses needs payments
that are feeless, instant, and verifiable by code. Every agent-commerce protocol today
settles on fee-bearing chains; Setu is structurally what they need.

Three agent layers sit ON TOP of the deterministic core (never inside it — an LLM in the
signing path would be slower, non-deterministic and attackable; validation stays pure
cryptography):

1. **Agents as economic actors.** Pay-per-request commerce: merchant returns 402 + invoice,
   buyer pays with `ref = invoice id` (signed into the order), merchant verifies the
   certificate offline with committee public keys. Possession of a valid certificate IS
   the credential — no accounts, no API keys. Implemented: `src/agents/demo-agents.ts`.
2. **Humans delegate to agents.** A principal's key signs a Plane 2 attestation naming the
   agent's address and a spend policy (budget / max-per-payment / expiry) — a portable
   verifiable credential any merchant checks offline. Implemented: `src/agents/delegation.ts`.
3. **Oversight is agents.** Sentinels audit cross-region consistency, equivocation evidence
   (Plane 2 keeps both branches of any equivocation permanently), and eventually committee
   rotation — the risk function as software. Seed implemented in the demo's sentinel.

Measured 2026-07-17 against the live 4-region network: 10 delegated, invoice-bound
micropayments, avg 186ms finality each; policy stop enforced at budget; forged
certificate rejected; sentinel found all regions consistent.

## v0 prototype scope (this repo)

- TypeScript, Node ≥ 20, **zero runtime dependencies** (node:crypto ed25519).
- 4 in-process authorities behind a `Network` interface with simulated latency —
  swap for libp2p transport in v0.2 without touching protocol code.
- Demo proves: (1) one-round-trip finality with measured latency; (2) settlement still
  works with 1 of 4 authorities down; (3) double-spend rejected — conflicting order
  cannot form a certificate; (4) equivocating (Byzantine) authority cannot enable a
  double-spend; (5) rate limit throttles a spammer with no fees.

## Roadmap

| Phase | Deliverable |
|---|---|
| v0 ✅ 2026-07-15 | In-process settlement core + adversarial demo (`npm run demo`) |
| v0.2 ✅ 2026-07-16 | Authorities as separate OS processes over localhost HTTP (`npm run demo:live`, ~4ms real-socket finality); libp2p/WAN transport still ahead |
| v0.3 ✅ 2026-07-16 | Plane 2: committee-less identity/attestation layer (`npm run demo:trust`) — hand-rolled BFT hash-DAG CRDT per the verified Kleppmann mechanism (signed content-addressed ops; forgery/tampering rejected, equivocation converges, attester-only revocation). Zero-dep instead of Automerge; swap in Automerge if rich document types are needed later |
| v0.35 ✅ 2026-07-17 | Functional: persistent authority state incl. pending locks (safety across restarts), long-running devnet (`npm run devnet`), wallet CLI (`node src/wallet.ts new/fund/pay/balance`, seq recovered from the network), benchmark (`npm run bench`: 423 TPS, 1000/1000 ok, p50 223ms under full load on one laptop) |
| v0.4d ✅ 2026-07-17 | Deployed: 4 authorities on Fly.io in 4 regions (lhr/fra/iad/sin) — committee-prod.json ships public keys only, private keys are per-app Fly secrets (SETU_PRIVATE_KEY); state on /tmp (survives process restart, not machine replacement — volumes later). Wallet CLI works against it via SETU_COMMITTEE=committee-prod.json |
| v0.4w ✅ 2026-07-17 | Browser wallet embedded in setu-mocha.vercel.app: WebCrypto Ed25519 keys in localStorage, faucet, pay form; wire-compatibility with the live network proven by `node src/webwallet-test.ts` (Node's crypto.subtle = browser API) |
| v0.5a ✅ 2026-07-17 | Agent layer: delegation credentials, payment-gated merchant (feeless 402 flow, invoice-bound certificates via `order.ref`), policy-enforced buyer agent, sentinel audit — all against the live network (`node src/agents/demo-agents.ts`) |
| v0.5e ✅ 2026-07-17 | Public explorer at setu-mocha.vercel.app/explorer.html: browser polls all 4 authorities' new `/stats` + `/recent` endpoints (privacy-preserving: short address prefixes, no full keys/identities); live counters, per-city node status, real-time payment feed |
| SEC ✅ 2026-07-17 | Fixed key-exposure incident (denylist `.vercelignore` shipped committee-prod.json/wallets.json/deploy secrets → all 4 authority private keys were publicly downloadable). Now strict allow-list; committee + wallets rotated; authorities redeployed |
| SDK ✅ 2026-07-17 | `packages/setu-pay` — zero-dep, Web-standard (WebCrypto+fetch, runs in Node/Deno/Bun/browser) client SDK: `SetuWallet` (create/load/balance/faucet/pay) + `SetuMerchant` (invoice/settle) + offline `verifyCertificate` (via new `/committee` endpoint). Full pay-per-request loop tested live: `node packages/setu-pay/example.ts` — paid 2 units in 198ms, delivered, replay rejected. This is the Phase-0 "5 lines to charge for a request" package |
| v0.4 | ZK receipt: prove "balance ≥ X" without revealing balance (Noir) |
| v0.5 | Post-quantum signature scheme behind the crypto seam; authority rotation |
| Bench | Honest comparison against FastPay's published 80k TPS / <100ms bar |
