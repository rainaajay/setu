# Implementation notes

Honest record of work actually completed (brief §47), and — as the brief requires — the
material deviations from a literal reading of it, with reasons.

## How this brief is being executed

The 48-section brief describes a multi-week production programme (persistence, a full
delegation-entity data model, service registry, signed quotes/receipts, x402 conformance,
MCP + OpenAI tools, an OpenAI review bridge, threat model, benchmark infrastructure, status/
governance surfaces, and a large test matrix). Delivering all of it in one pass and calling it
"done" would violate the brief's own rules ("verify public claims match implemented
capabilities"; "do not use documentation as a substitute for implementation"). It is therefore
being executed as **honest, real, strongest-first increments**, each leaving the system working.

## Increment 1 — 2026-07-24: automated protocol tests + capability registry

The single biggest gap between the existing prototype and an engineered system was that Setu
had narrative *demos* but **no assertion-based tests**. The brief mandates this (§19, §20, §45,
§48). This increment closes it, over the real code, with no protocol changes and no deploy risk.

**Added**
- `test/protocol.test.ts` — 12 assertion-based tests (Node's built-in runner, zero new deps),
  exercising the real `authority.ts` / `crypto.ts` / `certificates.ts` / delegation code:
  signature verify + tamper rejection + canonical determinism; happy-path quorum settlement;
  **value conservation** (no minting via transfers); **no double-spend** (conflicting order at
  the same sequence cannot certify); **sequence monotonicity / replay** rejection; insufficient-
  balance rejection; **Byzantine tolerance** (an equivocating authority cannot enable a second
  certificate); **offline receipt verification** (tamper / short-quorum / foreign-signer
  rejected); **idempotent settlement** (replayed certificate does not double-credit);
  **deterministic delegation policy** (per-payment cap, cumulative total → "exhausted", expiry,
  revocation, agent identity, forged-grant rejection); and **persistence/recovery** (balances,
  sequence, and delegation spend survive an authority restart from disk).
- `npm test` → `node --test "test/**/*.test.ts"` (scoped so it does not pull in the live-network
  helper scripts). Result: **12 passing, ~285 ms.**
- `capabilities.json` + `STATUS.md` — the honest capability register (§4), labelling every
  capability implemented-tested / implemented-unreviewed / partial / demonstration / planned, and
  stating plainly that the deployment is a **single-operator centralised research network**, that
  nothing has had **independent review**, and that production persistence is ephemeral.

**Not changed:** no protocol code, no cryptographic primitives, no deployed services, no network
state. The test suite is additive.

## Increment 2 — 2026-07-24: the definitive end-to-end agent-purchase journey (§6/§7/§45)

Turned the scattered demos into one **asserted** end-to-end flow, implementing the
service-commerce pieces it needs as real modules (not test scaffolding):

**Added (real application code, strip-mode-safe)**
- `src/service/quote.ts` — signed, machine-readable `Quote` (§13): binds price to a task hash
  and recipient, with expiry; `verifyQuote` checks signature + expiry.
- `src/service/service.ts` — `SetuService` (§11/§14/§15): issues quotes, and on redemption
  **verifies settlement server-side** against the committee keys before delivering; tracks
  **Settlement** and **Fulfilment** as separate states; single-use per quote.
- `src/service/registry.ts` — `ServiceRegistry` + `discover()` (§11/§12): structured discovery
  by capability / max price / region.
- `src/agent/purchase.ts` — `evaluatePurchase()` + `PurchaseDecision` (§5/§30): the agent's
  deterministic client-side pre-check (the authorities remain the real enforcer, §6).
- `src/audit.ts` — append-only `AuditLog` (§44).
- `test/e2e.test.ts` — **5 asserted E2E tests**: the full happy journey (fund → agent →
  delegate → discover → signed quote → policy decision → settle through quorum under the
  delegation → server-side receipt verification → fulfil → assert balance/budget → assert the
  ordered audit timeline → revoke → confirm further spend refused); plus denied-by-per-payment,
  denied-by-remaining-budget, replay-refused, and wrong-recipient-refused.

**Result:** `npm test` → **17 passing** (12 protocol + 5 E2E), ~290 ms. No protocol changes; the
new modules sit above the tested settlement/delegation core.

**Note:** these run against in-process authorities for determinism. A single *guided UI* over the
live network (one page walking a human through the same journey with a human timeline + technical
receipt) is the natural follow, together with migrating the live gateway to the signed `Quote`
object. The live gateway still uses the simpler invoice+ref form.

## Material deviations from a literal reading of the brief (with reasons)

1. **No Postgres/Prisma data model (§43).** The existing persistence is deliberately dependency-
   free file-based state (`SETU_STATE_DIR`). The brief says "use the existing persistence
   technology" and "do not duplicate architecture". Introducing a relational DB + ORM would be a
   large new architecture at odds with the zero-dependency design. Deviation: strengthen and
   *test* the existing file persistence now; a durable store (volumes/backup, RPO/RTO) is a
   scoped later increment.
2. **OpenAI review bridge (§42) and OpenAI tools (§29) not built this increment.** They require an
   OpenAI API key (a *different* provider from the Anthropic key already used for the agent brain)
   and a redaction/secret-scanning pipeline that must not be shipped untested. Deferred to a
   dedicated increment, default-disabled, once a key and the redaction allowlist exist.
3. **Public information-architecture / status-page rebuild (§5, §39) not done this increment.**
   The current public copy uses "live" loosely; §4/§5 require an honesty pass. That is a real
   piece of work (a new IA + a status page fed by health checks) and is the natural next
   increment. `STATUS.md` + `capabilities.json` are the honest register in the meantime.
4. **The definitive single E2E journey (§6/§45) and its harness are not yet one automated flow.**
   The pieces exist (fund → delegate → discover via gateway → pay → verify → deliver → revoke),
   but as separate demos. Turning them into one asserted end-to-end test + one guided UI is a
   scoped increment.

None of these deviations weakens the settlement protocol, introduces an insecure shortcut, or
misrepresents a demo as production.

## Planned increments (strongest-first)

1. **Public honesty pass (§4/§5/§39):** rebuild the site IA around the capability register; add a
   real status page fed by authority/service health; make "live" mean what §4 says.
2. **One asserted end-to-end journey (§6/§7):** fund → agent → delegate → discover → quote →
   policy → settle → verify → fulfil → audit → revoke, as a single integration test and a single
   guided demonstration, with a human timeline + technical receipt.
3. **Durable persistence + recovery (§20):** Fly volumes, backup, documented RPO/RTO, and
   integration tests for authority DB restart / one-authority-down / partition.
4. **Threat model (§24)** and **key-rotation design (§17/§25)**.
5. **x402 conformance (§27)** against pinned fixtures, and **MCP read/write tool split +
   idempotency (§28)**.
6. **OpenAI tools + review bridge (§29/§42)**, default-disabled, allowlist-bundled, redacted.
