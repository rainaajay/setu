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

**Tested protocol core** (`implemented-tested`, `npm test` → 12 passing): quorum-signed
settlement, double-spend prevention, sequence/replay protection, Byzantine tolerance (f=1 of 4),
value conservation, offline receipt verification, idempotent settlement, server-enforced
delegated budgets (per-payment cap, cumulative total, expiry, revocation, agent identity), and
restart recovery from disk.

**Real but not yet test-covered** (`implemented-unreviewed`): the MCP server, the setu-pay SDK,
authority key handling (Fly secrets, not HSM).

**Partial** (works, with stated gaps): the x402-style gateway (shape-compatible, not conformance-tested),
production persistence (ephemeral `/tmp`, no durable volume/backup), the signed-quote and
settlement/fulfilment models, the A2A card (schema-shaped), issuance/reconciliation, and benchmarks
(laptop + live WAN, not production-scale).

**Planned** (not built): policy simulation, principal-approval workflow, service registry &
discovery, OpenAI tools & review bridge, authority rotation/governance, operator admin, status &
incident pages, and the written threat model.

**Demonstration only:** the resident agent economy — a controlled test environment, not evidence
of a viable macroeconomy.

See `IMPLEMENTATION_NOTES.md` for what changed in each increment and why.
