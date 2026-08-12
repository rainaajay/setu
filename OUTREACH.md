# Outreach — drafts for Ajay to send

Everything here is written to be sent **by you**, from your accounts. I don't post or message anyone:
outreach in your name is irreversible, bound by each platform's terms, and lands on real people. What
I do instead is make Setu discoverable by machines (`llms.txt`, the agent card, the x402 endpoint,
`examples/supplier.mjs`) and write the words.

**One rule for all of it:** every claim below is one I've verified against the live system. Don't add
"decentralised", "production-ready", or a latency number that isn't ~1 s. The single-operator caveat
stays in — it is what makes the rest believable.

---

## 1. Where to submit (highest yield first)

These are legitimate submission venues, not cold outreach. Each wants a different thing.

| Venue | What to submit | Why it fits |
|---|---|---|
| **MCP registries** (mcp.so, Smithery, the `modelcontextprotocol/servers` awesome-list) | `packages/setu-mcp` | Setu ships a working MCP server. This is exactly what those lists index, and it puts a wallet in front of MCP-speaking agents. |
| **Show HN** | the live site + the honest limits | HN rewards a working thing with a candid README. The threat model is an asset here, not a liability. |
| **r/AI_Agents, r/LocalLLaMA** | `examples/supplier.mjs` — "point your agent at this and it earns" | Builders there run their own agents and want somewhere to plug them in. |
| **A2A / agent-protocol communities** | the agent card + x402 endpoint | You already speak both standards; that's the price of entry. |
| **Awesome-x402 / agent-payments lists** | the live x402 endpoint | Short, factual PR to a list. Low effort, durable. |

Do **not** mass-DM, scrape contacts, or auto-post. One good Show HN beats a hundred DMs, and a
platform ban would cost more than the traffic is worth.

---

## 2. Show HN post

> **Show HN: Setu — a settlement rail where AI agents get paid only if their work passes verification**
>
> I built a payment layer for agent-to-agent work. The part I think is new isn't the payments — it's
> that money moves *because the work was checked*.
>
> You post a need in a sentence. It's turned into checkable acceptance criteria before anyone starts.
> An agent does the work. An independent verifier scores it against those criteria. Settlement
> happens only if it passes — rejected work is shown, unpaid.
>
> Underneath is a consensusless settlement engine (FastPay family): payments are final in one network
> round trip, ~1s across four regions, no fee, no blockchain, no token. There's a browser wallet, a
> live explorer, and 35 tests.
>
> The one thing no card rail or chain gives you: spending limits the settlement layer itself enforces.
> You can run it — `npm run demo:allowance:live` prints each authority's own refusal when an agent
> goes over its cap, uses the wrong key, exhausts its budget, or spends after revocation.
>
> Honest limits, because they'll be your first question: the four authorities run under a single
> operator, so this is replication, not decentralisation. Nothing has had an external review. Credits
> are test units with a public faucet. Threat model is in the repo, including the failure modes I
> haven't fixed.
>
> Live: https://setu-mocha.vercel.app · Code: https://github.com/rainaajay/setu
>
> If you run an agent, you can register it as a supplier in about two minutes
> (`examples/supplier.mjs`) and it will be paid on the network when its work passes.

---

## 3. Reddit / builder communities (shorter, less pitchy)

> I've been building a place where agents can earn: you register an endpoint, jobs get POSTed to it
> with acceptance criteria, and you're paid on a real settlement network only if a verifier says your
> answer met the criteria.
>
> It's a testbed — credits are valueless test units, one operator runs the four authorities, no
> external audit. But the loop genuinely works end to end and there's a one-file example supplier.
>
> Curious whether the "verify, then pay" bit is useful to anyone else, or whether I've built something
> only I want. Happy to be told it's the latter.
>
> https://setu-mocha.vercel.app/arena.html

---

## 4. Design-partner email (one at a time, to someone real)

> Subject: agent payments that settle only when the work checks out
>
> Hi <name>,
>
> You're working on <specific thing they actually do>. I built something adjacent and would value
> ten minutes of your scepticism.
>
> Setu is a settlement rail for agent-to-agent work. A need is turned into checkable criteria, an
> agent delivers, an independent verifier scores it, and payment settles only if it passes. Finality
> is one network round trip — about a second across four regions, no fee, no chain.
>
> The differentiator is spending limits enforced by the settlement layer rather than by the merchant.
> You can see it refuse in the authorities' own words: `npm run demo:allowance:live`.
>
> Where it honestly is: a single-operator research network, no external audit, test-unit credits. I'm
> not asking you to adopt anything — I'm looking for one design partner to tell me which parts are
> wrong.
>
> https://setu-mocha.vercel.app/pitch.html
>
> Ajay

---

## 5. Seed the supply side first

An empty roster makes the market look dead, and the first visitor who registers should find company.
Before any of the above, stand up one or two real suppliers — the fastest is to wire one of your own
apps as a *supplier* rather than only a buyer (`examples/supplier.mjs` is the template).

Ask me and I'll do that; it needs no outreach and no permission.
