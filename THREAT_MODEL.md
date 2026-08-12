# Setu — threat model

What Setu defends against, what it does **not**, and the boundaries a reader should judge it by.
Written to be falsifiable: every claim here is either covered by a test in `test/` (named) or listed
as an open gap. Nothing here has had independent external review.

**Scope.** The settlement layer (`src/authority.ts`, `src/client.ts`, `src/certificates.ts`), the
delegation model (`src/agents/allowance.ts`), and the live deployment (four authorities on Fly.io).
The resident economy (`packages/setu-economy`) is a demonstration and is treated as untrusted input.

---

## 1. Trust model — state it plainly

- **The committee is four authorities under a SINGLE operator**, one codebase, one cloud, related
  credentials. This is **replication, not decentralisation**. A reader must not infer Byzantine
  independence from the 3-of-4 quorum: the operator can rewrite all four.
- **Credits are closed-loop test units**, not money and not a claim on anything. The faucet is public.
- Safety threshold: **f = 1 of 4** (quorum 3). Two dishonest authorities break the safety argument.

## 2. What is defended, and what proves it

| Property | Mechanism | Test |
|---|---|---|
| No double-spend | First-seen lock per (account, seq) + quorum overlap | `protocol.test.ts` |
| No value creation via transfers | Debit/credit conservation checked over the whole address set | `protocol.test.ts` |
| No cross-track minting | `reservedAgainst()` subtracts every pending draw on a balance, so a direct and a delegated spend cannot both pass an independent balance check | `protocol.test.ts` (Cycle 4) |
| Replay / stale sequence | Monotonic `nextSeq`; settled certs are idempotent | `protocol.test.ts` |
| Byzantine authority signing everything | Quorum overlap — an equivocator cannot manufacture a second certificate | `protocol.test.ts` |
| Forged / short-quorum receipts | Offline certificate verification against committee keys | `protocol.test.ts` |
| Over-spend by a delegated agent | Server-enforced allowance: per-payment cap, cumulative total, expiry, revocation, agent identity | `protocol.test.ts` |
| Faucet corrupting state | `fund()` rejects non-integer / zero / negative amounts and malformed addresses; HTTP layer adds per-call, per-balance and per-IP caps | `protocol.test.ts` (2026-08-02) |
| Crash mid-write | Atomic temp+rename with one `.bak` generation; resilient load; refuses to start if all copies are unreadable | `persistence.test.ts` |
| Partition / lagging authority (OUTGOING spends) | Explicit sequence gap; safety holds; heals on ordered replay | `protocol.test.ts` (§18) |
| Failed settle leg | Client retries the stragglers in the background so the ledger converges | `protocol.test.ts` (retry heals a lagging authority) |
| Address bricked by partial delivery | Wallet caches certificates and replays them to laggards before signing | `protocol.test.ts` (partial delivery cannot brick an address) |
| Diverged authority (incl. silent incoming credits) | Anti-entropy: digest comparison + certificate pull, re-verified locally | `protocol.test.ts` (anti-entropy repairs a diverged authority) |

## 3. Known gaps — the honest list

1. **No authority-to-authority anti-entropy — and missed INCOMING credits diverge silently.**
   Settlement application is entirely client-driven. Two distinct failure modes:
   - *Missed outgoing spend*: the authority refuses all later certificates for that sender
     (`sequence gap (authority behind)`) until the missed ones are replayed **in order**. Loud, and
     it stops there.
   - *Missed incoming credit*: **silent and permanent.** `nextSeq` tracks the sender only, so an
     authority that misses a payment where an account was the *recipient* shows a wrong balance
     forever with no error and no gap. **Observed live 2026-08-02:** one account read `nextSeq 8097`
     on all four authorities — identical — while its balance read **2,325 on auth-1 and 4,999 on the
     other three**. A client that happens to query the lagging authority gets a wrong balance, and
     that authority will refuse otherwise-valid spends.
   **Mitigations shipped 2026-08-02**, in order of strength:
   - *Client retry*: failed settle legs are retried in the background, so a transient failure no
     longer strands an authority.
   - *Client-side catch-up*: wallets cache the certificates they form and replay them to laggards
     before signing the next order — this is what stops an address being bricked.
   - *Authority anti-entropy* (`/digest`, `/certs`, and a 30 s sync loop): an authority compares
     sequence digests with a random peer and pulls the certificates it missed, applying each through
     its **own** `handle()` — so a peer is granted no trust and can only supply certificates that
     would have been accepted anyway. Proven by test, including the silent incoming-credit case.
   The certificate log is **durable** (appended per settlement to `<state>.certs.jsonl`, recovered and
   trimmed at boot), so a restarted peer can still serve history — without that, the very condition
   that makes a peer need certificates (a restart) was the condition that emptied the log holding
   them, and reconciliation could never converge. Regression test: *anti-entropy still works after
   the SERVING peer restarts* (it fails if the durable log is disabled).
   **What it does NOT fix — and this is worse than first documented.** The certificate log is a
   bounded FIFO (`CERT_LOG_MAX = 20_000`), so each authority retains only its most recent
   certificates — measured 2026-08-07, roughly **two days** of history at ~9,100 settlements/day,
   and `certsHeld` reads exactly 20,000 on all four (saturated, evicting continuously). Catch-up is
   strictly in order and always starts from the *oldest* missing sequence. So once that oldest
   certificate has been evicted by **every** peer, the gap can never close — and because the sender
   keeps transacting, **every later payment widens it**. This is progressive, unbounded divergence,
   not a fixed historical artefact.
   Measured: auth-1 was 14,759 behind on 2026-08-02, 24,815 on 2026-08-07 and **31,455 on
   2026-08-12** — roughly +2,000/day, all of it accumulated *after* durable retention shipped.
   **The testbed ledger was reset on 2026-08-12** (every authority pointed at a fresh state
   directory; the old data is untouched on the volumes) because that gap had no repair path left.
   The underlying limit is unchanged: any authority that falls behind and is not repaired within the
   retention window (~2 days) is permanently unrepairable, and the reset does not fix that — it only
   cleared the accumulated damage.
   Anti-entropy therefore heals a **short** outage; it cannot heal a long one, and it cannot rewrite
   history. Two things would change this: retaining certificates for longer (disk is cheap — the logs
   are already 30–39 MB) and, more fundamentally, a state-transfer path so a hopelessly-behind
   authority can be re-seeded from a peer's balances rather than replaying every certificate.
   *Safety is intact throughout* (quorum overlap still prevents double-spend); this remains a
   **consistency** gap and the most significant open defect.
2. **No lock cancellation or timeout.** A pending order that gets a signature but never settles
   freezes that (account, seq) — and its reserved funds — indefinitely. There is no protocol-level
   cancellation. The resident economy papers over this by rotating a stuck client's wallet; the
   protocol itself has no remedy. This is the most likely cause of a "stuck account" in practice.
3. **Clock-skew on delegation expiry.** `Date.now() > Date.parse(expiresAt)` is evaluated per
   authority with no tolerance, so at the expiry boundary authorities can split and an order stalls
   below quorum. A bounded `SKEW_MS` tolerance would close it. Untested.
4. **Rate-limit consumed before the idempotent-retry check.** An honest client re-sending its own
   already-pending order burns a token each time and can be throttled while driving its valid lock to
   quorum — a self-inflicted liveness throttle.
5. **Key management.** Authority private keys are Fly secrets, **not** HSM-protected, with **no
   rotation mechanism**. Compromise of two keys breaks safety; there is no recovery procedure.
6. **No independent review.** Every `reviewed:` flag in `capabilities.json` is `false`.
7. **Public faucet.** Deliberate and documented: anyone can mint bounded test Credits. Amounts,
   per-address balance and per-IP rate are capped, so it cannot corrupt state or bloat it without
   limit — but it means on-network balances carry no scarcity claim.
8. **Denial of service.** Per-account token buckets price spam without fees, but there is no
   protection against a distributed flood of well-formed orders from many addresses, and the
   authorities run on 256MB shared-CPU machines.

## 4. Explicitly out of scope

- Smart contracts / general computation (deliberately given up — incompatible with consensus-free
  settlement).
- Privacy: orders and balances are visible to every authority, and the explorer publishes short
  address prefixes and amounts.
- Regulatory status: Credits are not money, not e-money, not a stablecoin, not a security.
- Anything about the *content* produced by the resident economy's AI agents.

## 5. If you are evaluating Setu

The load-bearing question is **not** "is the cryptography right" — it is **"who runs the four
authorities?"** Today: one person. Until authorities are operated by genuinely independent parties
with rotated, HSM-held keys and an anti-entropy protocol, Setu is a **single-operator research
network** that demonstrates a consensus-free settlement design. That is what it claims to be.
