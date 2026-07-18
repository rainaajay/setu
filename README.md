# Setu

A post-blockchain settlement prototype: Byzantine fault-tolerant payments **without
consensus, blocks, mining, or fees** — finality in one network round trip. Based on the
FastPay/pod/ABC line of research; see [SPEC.md](SPEC.md) for the design and the evidence
behind every choice.

## Live network

Four authorities run on Fly.io in London, Frankfurt, Washington DC and Singapore
(`setu-auth-1..4.fly.dev`; committee in `committee-prod.json`, public keys only —
private keys are Fly secrets). Payments from a laptop settle in ~200 ms:

```
$env:SETU_COMMITTEE = "$PWD\committee-prod.json"   # PowerShell
node src/wallet.ts new me
node src/wallet.ts fund me 1000        # devnet-style genesis; endpoint is demo-only
node src/wallet.ts pay me <to> 100
node src/wallet.ts balance me          # as seen by each of the 4 authorities
```

Each authority app runs exactly one machine (an authority is a single logical signer —
Fly's default 2-machine HA split one authority's state in two and broke quorum funding;
`fly scale count 1` is part of the deploy procedure). State lives on the machine's
ephemeral disk: it survives process restarts, not machine replacement. Redeploy:
`flyctl deploy . -c deploy/auth-N/fly.toml --dockerfile Dockerfile --remote-only`.

## Use it from an AI agent (MCP)

Setu ships an MCP server so any MCP-speaking agent (Claude Desktop, Claude Code, …) can
hold a wallet, pay other agents, and charge for its own services — no Setu-specific code.
See [packages/setu-mcp](packages/setu-mcp/). One line of client config:

```json
{ "mcpServers": { "setu": { "command": "node", "args": ["<path>/packages/setu-mcp/server.ts"] } } }
```

## Run locally

Requires Node ≥ 23.6 (native TypeScript). Zero dependencies.

```
node src/devnet.ts      # persistent local devnet (state in ./state), then use wallet.ts
node src/bench.ts       # throughput benchmark: 423 TPS, p50 223 ms under full load (one laptop)
node src/chain-bench.ts # chained-spend benchmark: can Bob immediately spend money he just
                        # received? 280/280 chained spends first-try, no extra sync delay,
                        # survives an authority failure (localhost)
node src/chain-bench-wan.ts # same, against the LIVE 4-region network: 48/48 chained spends
                        # first-try, ~183 ms/hop, no extra delay over a fresh payment
```

```
node src/demo.ts        # v0:   Plane 1 in-process, simulated latency
node src/demo-live.ts   # v0.2: Plane 1, 4 authorities as real OS processes over localhost HTTP
node src/demo-trust.ts  # v0.3: Plane 2, committee-less P2P trust layer (BFT hash-DAG CRDT)
node src/demo-allowance.ts # server-enforced delegated budgets: authorities track cumulative
                        # spend, per-payment cap, and revocation — a signed credential alone
                        # cannot be over-spent or double-presented across merchants
node src/demo-issuer.ts # what a unit IS: a closed-loop Credit issued from a fixed-supply
                        # Treasury (every unit traces to the issuer; supply conserved). See CREDITS.md
```

Plane 1 demos prove: one-round-trip finality (~4ms over real sockets), liveness with an
authority process killed mid-flight, double-spend impossibility, safety against a
Byzantine authority, and fee-less anti-spam via per-account rate limits.

The Plane 2 demo proves: P2P convergence with no committee or server, offline-first
catch-up, forged/tampered ops rejected by every honest peer, equivocation unable to
split the network, and attester-only revocation.

## Layout

- `src/crypto.ts` — ed25519 + canonical serialization; the post-quantum swap seam
- `src/types.ts` — orders, signatures, certificates
- `src/network.ts` — network abstraction (v0: in-process with simulated latency)
- `src/authority.ts` — the protocol core: first-seen locking, quorum settlement, rate limiting; plus an equivocating authority for adversarial demos
- `src/client.ts` — wallet: broadcast order → collect quorum → certificate = finality
- `src/keygen.ts`, `src/authority-server.ts`, `src/httpNetwork.ts` — v0.2 multi-process deployment
- `src/trust/op.ts`, `src/trust/peer.ts` — Plane 2: signed content-addressed ops in a hash-DAG; local-first peers that gossip and converge
- `src/demo.ts`, `src/demo-live.ts`, `src/demo-trust.ts` — the adversarial scenario suites
