// A signed, machine-readable price quote for a service (brief §13). The service signs it,
// binding a price to a specific task (by hash) and a recipient account, with an expiry. The
// price cannot change after signing without issuing a new quote.
import { canonical, sign, verify, type KeyPair } from '../crypto.ts';

export interface Quote {
  id: string;
  service: string; // service id
  capability: string;
  taskHash: string; // sha256 of the exact task, so the quote is bound to the work
  price: number;
  unit: string;
  payTo: string; // recipient account (the service's address)
  createdAt: string;
  expiresAt: string;
  version: number;
}

export interface SignedQuote {
  quote: Quote;
  serviceSignature: string;
}

export function signQuote(service: KeyPair, quote: Quote): SignedQuote {
  return { quote, serviceSignature: sign(service.privateKey, canonical(quote)) };
}

export function verifyQuote(
  sq: SignedQuote,
  servicePublicKey: string,
  now: number = Date.now(),
): { valid: true } | { valid: false; reason: string } {
  if (!verify(servicePublicKey, canonical(sq.quote), sq.serviceSignature))
    return { valid: false, reason: 'bad service signature' };
  if (Date.parse(sq.quote.expiresAt) < now) return { valid: false, reason: 'quote expired' };
  return { valid: true };
}
