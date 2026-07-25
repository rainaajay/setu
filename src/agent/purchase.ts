// The agent's client-side purchase decision (brief §5/§30). The model/agent may PROPOSE a
// purchase; this deterministic check decides whether it is worth submitting under the
// delegation's known limits. The authorities remain the real enforcer (§6) — this is the
// agent being a good citizen and not wasting a doomed settlement attempt.
export interface DelegationView {
  id: string;
  total: number;
  spent: number;
  maxPerPayment: number;
  expiresAt: string;
  revoked: boolean;
  allowedServices?: string[]; // if set, only these service ids are permitted
}

export interface QuoteView {
  id: string;
  service: string;
  price: number;
  expiresAt: string;
}

export interface PurchaseDecision {
  permitted: boolean;
  reason: string;
  service?: string;
  price?: number;
  remainingAfter?: number;
}

export function evaluatePurchase(quote: QuoteView, del: DelegationView, now: number = Date.now()): PurchaseDecision {
  if (del.revoked) return { permitted: false, reason: 'delegation revoked' };
  if (Date.parse(del.expiresAt) < now) return { permitted: false, reason: 'delegation expired' };
  if (Date.parse(quote.expiresAt) < now) return { permitted: false, reason: 'quote expired' };
  if (quote.price > del.maxPerPayment) return { permitted: false, reason: 'exceeds per-payment limit' };
  if (del.spent + quote.price > del.total) return { permitted: false, reason: 'exceeds remaining budget' };
  if (del.allowedServices && !del.allowedServices.includes(quote.service))
    return { permitted: false, reason: 'service not on the allowlist' };
  return {
    permitted: true, reason: 'within policy',
    service: quote.service, price: quote.price,
    remainingAfter: del.total - del.spent - quote.price,
  };
}
