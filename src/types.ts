export interface TransferOrder {
  sender: string; // public key / address (for delegated orders, the AGENT's key)
  recipient: string;
  amount: number; // integer units
  seq: number; // sequence number: per-account, or per-delegation for delegated orders
  ref?: string; // optional payment reference (e.g. an invoice id) — covered by the
  // sender's signature, so a certificate cryptographically proves THIS purchase was paid
  delegation?: string; // if set, this payment spends the PRINCIPAL's funds under a
  // registered allowance; the authorities enforce the cumulative budget (not the merchant)
}

// A spending allowance a principal grants to an agent, signed by the principal and
// registered with the authorities. The authorities hold the mutable state (spent,
// nextSeq, revoked) — the signed object below is only the immutable grant.
export interface DelegationAllowance {
  id: string; // unique delegation id
  principal: string; // the account funds are drawn from
  agent: string; // the key permitted to spend
  total: number; // cumulative ceiling across all payments
  maxPerPayment: number;
  expiresAt: string; // ISO timestamp
}

export interface SignedAllowance {
  allowance: DelegationAllowance;
  principalSignature: string; // principal signs canonical(allowance)
}

export interface RevokeDelegation {
  delegation: string;
  principal: string;
}
export interface SignedRevoke {
  revoke: RevokeDelegation;
  principalSignature: string;
}

export interface SignedOrder {
  order: TransferOrder;
  senderSignature: string;
}

export interface AuthoritySignature {
  authority: string; // authority public key
  signature: string; // over canonical(order)
}

// A quorum certificate. Its existence IS finality: no conflicting order at the same
// (sender, seq) can ever gather a quorum, because honest authorities lock on first-seen.
export interface Certificate {
  order: TransferOrder;
  senderSignature: string;
  authoritySignatures: AuthoritySignature[];
}

export type OrderResponse =
  | { ok: true; signature: AuthoritySignature }
  | { ok: false; error: string };

export type SettleResponse = { ok: true } | { ok: false; error: string };

export type Message =
  | { type: 'order'; signedOrder: SignedOrder }
  | { type: 'certificate'; certificate: Certificate }
  | { type: 'register-delegation'; signedAllowance: SignedAllowance }
  | { type: 'revoke-delegation'; signedRevoke: SignedRevoke };
