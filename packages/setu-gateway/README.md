# setu-gateway

An [x402](https://x402.org)-style HTTP payment gateway over Setu. It sells a resource that
**any agent can pay for over the web** with no Setu-specific code beyond "pay this address on
Setu", and publishes an [A2A](https://a2aproject.github.io/A2A/)-style agent card so agents can
discover it. Zero dependencies; wraps the setu-pay SDK.

Live: <https://setu-gateway.fly.dev>

## The flow

```
GET /premium-quote                      → 402 { accepts: [{ scheme:"setu", payTo, invoiceId, … }] }
pay payTo on Setu with ref = invoiceId  → certificate
GET /premium-quote  X-PAYMENT: base64({scheme, invoiceId, certificate})  → 200 + resource
```

The certificate is verified offline against the committee keys; each invoice is single-use.

## Endpoints

- `GET /.well-known/agent-card.json` — discovery descriptor (name, skills, how to pay)
- `GET /premium-quote` — payment-gated resource (402 → pay → 200)
- `GET /health`

## Try it

```
node demo.ts                                  # spawns a local gateway, pays it via live Setu
GATEWAY_URL=https://setu-gateway.fly.dev node demo.ts   # pays the LIVE gateway
```

## Run your own

```
PORT=8080 HOST=0.0.0.0 PUBLIC_URL=https://your-host node gateway.ts
```

Test units, not money. MIT.
