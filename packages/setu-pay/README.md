# setu-pay

Feeless, instant, blockchain-free payments — for agents and apps. A wallet pays; a
merchant charges and verifies. Payments are final in one network round trip (~200 ms
across four continents), with no chain, no mining, no token, and no fee.

Runs anywhere Web APIs exist: Node ≥ 20, Deno, Bun, and the browser. Zero dependencies.

## Charge for a request — the whole thing

```ts
import { SetuWallet, SetuMerchant, MAINNET } from 'setu-pay';

// merchant side
const merchantWallet = await SetuWallet.create();
const merchant = new SetuMerchant(merchantWallet.address);
const invoice = merchant.invoice('gpt-answer', 2);      // 402: { id, price, payTo }

// buyer side
const buyer = await SetuWallet.create();
await buyer.faucet(10);                                  // testnet units
const receipt = await buyer.pay(invoice.payTo, invoice.price, invoice.id);

// merchant verifies the certificate offline and delivers
const ok = await merchant.settle(invoice.id, receipt.certificate);
// ok.ok === true, and the same certificate can never be redeemed twice
```

That is the full pay-per-request loop: no accounts, no API keys, no card on file.
Possession of a valid settlement certificate *is* the credential, and anyone can verify
it with only the committee's public keys.

## Wallet API

```ts
const w = await SetuWallet.create();          // keys generated locally, never leave the device
w.address                                     // your address (an Ed25519 public key)
await w.faucet(500)                           // request test units (testnet only)
await w.balance()                             // majority balance across authorities
await w.pay(to, amount, ref?)                 // -> { certificate, latencyMs, settledOn }

const saved = await w.export()                // { secret, address } — store it safely
const w2 = await SetuWallet.load(saved)       // restore later
```

## Merchant API

```ts
const m = new SetuMerchant(myAddress);
const inv = m.invoice('resource-name', price); // -> { id, price, payTo }
await m.settle(inv.id, certificate);           // verifies + is single-use
```

## Verify a payment yourself

```ts
import { verifyCertificate, MAINNET } from 'setu-pay';
const v = await verifyCertificate(certificate, MAINNET);   // { valid: true } | { valid, error }
```

## Try it

```
node packages/setu-pay/example.ts
```

Network: <https://setu-mocha.vercel.app> · Live explorer: <https://setu-mocha.vercel.app/explorer.html>

MIT licensed. This is a testnet; units are not money.
