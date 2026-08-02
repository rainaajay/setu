# Setu — capability status

The honest register of what is real, what is demonstrated, and what is planned. The
machine-readable source is [`capabilities.json`](capabilities.json). Nothing here has had an
**independent external review** yet (`reviewed: false` everywhere) — that is a prerequisite
before any real-value use.

**"Live" here means the protocol capability actually works** — the service runs, the
transaction succeeds, state persists, verification works — not merely that a web page is
deployed.

**Network reality:** the four authorities run under a **single operator, one codebase, one
cloud, related credentials**. That is a centralised research deployment (replication), *not*
decentralised governance. Independent operators are on the roadmap.

## Status legend

| Status | Meaning |
|---|---|
| `implemented-tested` | Real code with automated tests in `test/` |
| `implemented-unreviewed` | Real code, runs, but no automated test coverage yet |
| `partial` | Some of the capability exists; named gaps remain |
| `demonstration` | A controlled demo/test environment, not a production claim |
| `planned` | Not built |

## Summary

**Tested protocol core** (`implemented-tested`, `npm test` → 26 passing: 15 protocol + 5 e2e + 5 persistence + 1 economy smoke): quorum-signed
settlement, double-spend prevention, sequence/replay protection, Byzantine tolerance (f=1 of 4),
value conservation, offline receipt verification, idempotent settlement, server-enforced
delegated budgets (per-payment cap, cumulative total, expiry, revocation, agent identity), and
restart recovery from disk.

**Real but not yet test-covered** (`implemented-unreviewed`): the MCP server, the setu-pay SDK,
authority key handling (Fly secrets, not HSM).

**Durable persistence** (`implemented-tested`): authorities write state with crash-safe atomic
writes + a backup generation, load resiliently, and run on durable Fly volumes — verified that
state survives a machine restart. (No multi-node failover / snapshot policy yet.)

**Partial** (works, with stated gaps): the x402-style gateway (shape-compatible, not conformance-tested),
the A2A card (schema-shaped), issuance/reconciliation, and benchmarks (laptop + live WAN, not
production-scale).

**Planned** (not built): policy simulation, principal-approval workflow, service registry &
discovery, OpenAI tools & review bridge, authority rotation/governance, operator admin, and status &
incident pages.

**Threat model** ([THREAT_MODEL.md](THREAT_MODEL.md), written 2026-08-02): states the single-operator
trust model plainly, maps each defended property to a named test, and lists the open gaps —
no authority-to-authority anti-entropy, no lock cancellation, clock-skew on delegation expiry, keys
without HSM or rotation, and the deliberate public faucet. Not externally reviewed.

**Demonstration only:** the resident agent economy — a controlled test environment, not evidence
of a viable macroeconomy. It runs a **live, budget-capped LLM** (claude-haiku-4-5): a $60/mo hard
cap plus per-IP (15) and global (300) daily commission limits, with spend-to-date visible at
`/state`. Payments still settle when the budget is spent — you get a verified receipt, no
deliverable. Economy state and the budget/rate counters persist to a durable Fly volume
(`SETU_STATE_DIR`) with atomic writes and are restored on boot, and `monthTick()` makes the $60/mo
cap a true monthly ledger (verified across a machine restart, Cycle 3); the Anthropic account limit
is the ultimate backstop.

See `IMPLEMENTATION_NOTES.md` for what changed in each increment and why.
