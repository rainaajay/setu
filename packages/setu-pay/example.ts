// The whole pay-per-request loop against the LIVE Setu network — merchant + buyer.
// Run: node packages/setu-pay/example.ts
import { SetuWallet, SetuMerchant, MAINNET } from './index.ts';

// --- a merchant: charge 2 units for a "quote" ---
const merchantWallet = await SetuWallet.create(MAINNET);
const merchant = new SetuMerchant(merchantWallet.address);

// --- a buyer: fund from faucet, then buy ---
const buyer = await SetuWallet.create(MAINNET);
await buyer.faucet(10);
console.log(`buyer funded; balance ${await buyer.balance()}`);

// 1. buyer asks; merchant returns an invoice (the 402 step)
const invoice = merchant.invoice('gold-price-quote', 2);

// 2. buyer pays the invoice on the network — final in one round trip
const receipt = await buyer.pay(invoice.payTo, invoice.price, invoice.id);
console.log(`paid ${invoice.price} — FINAL in ${receipt.latencyMs.toFixed(0)}ms, settled on ${receipt.settledOn}/4`);

// 3. merchant verifies the certificate (offline, with committee keys) and delivers
const result = await merchant.settle(invoice.id, receipt.certificate);
console.log(result.ok ? `delivered "${result.resource}" to ${result.payer.slice(16, 24)}…` : `refused: ${result.error}`);

// 4. proof: the same certificate cannot be replayed for a second delivery
const replay = await merchant.settle(invoice.id, receipt.certificate);
console.log(`replay attempt → ${replay.ok ? 'ACCEPTED (bug!)' : 'rejected: ' + replay.error}`);

console.log(`buyer balance now ${await buyer.balance()}`);
