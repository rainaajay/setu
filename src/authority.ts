import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { canonical, generateKeyPair, sign, verify, type KeyPair } from './crypto.ts';
import type {
  Certificate,
  Message,
  OrderResponse,
  SettleResponse,
  SignedAllowance,
  SignedOrder,
  SignedRevoke,
} from './types.ts';

// Server-side allowance state. The signed grant is immutable; spent / nextSeq / revoked
// are the mutable state the authorities enforce so a budget cannot be over-spent, even
// if the agent presents its credential to many merchants at once.
interface DelegationState {
  principal: string;
  agent: string;
  total: number;
  maxPerPayment: number;
  expiresAt: string;
  spent: number;
  nextSeq: number;
  revoked: boolean;
  pending?: SignedOrder;
}

interface AccountState {
  balance: number;
  nextSeq: number;
  pending?: SignedOrder; // first-seen lock: the safety mechanism
}

// Anti-spam without fees (SPEC.md: the IOTA lesson). Each account gets a token bucket;
// an empty bucket rejects the order — no gas market, no fee auction.
class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();
  private capacity: number;
  private refillPerSecond: number;

  constructor(capacity = 5, refillPerSecond = 2) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.tokens = capacity;
  }

  tryConsume(): boolean {
    const now = Date.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.lastRefill) / 1000) * this.refillPerSecond,
    );
    this.lastRefill = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export class Authority {
  readonly keys: KeyPair;
  protected accounts = new Map<string, AccountState>();
  private buckets = new Map<string, TokenBucket>();
  private committee: string[] = [];
  private quorum = 0;

  readonly name: string;
  private stateFile?: string;
  // Public activity feed for the explorer. Rolling, in-memory, privacy-preserving:
  // short address prefixes only, never full keys. Not consensus state.
  private settledCount = 0;
  private volume = 0;
  private recent: { from: string; to: string; amount: number; ref?: string; at: number }[] = [];
  private delegations = new Map<string, DelegationState>();

  // With stateFile set, the authority survives restarts. Pending locks are persisted
  // too — an authority that forgot its lock could countersign a conflicting order,
  // which is exactly the safety hole persistence must close.
  constructor(name: string, keys?: KeyPair, stateFile?: string) {
    this.name = name;
    this.keys = keys ?? generateKeyPair();
    this.stateFile = stateFile;
    if (stateFile && existsSync(stateFile)) {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as {
        accounts: Record<string, AccountState>;
        delegations?: Record<string, DelegationState>;
      };
      this.accounts = new Map(Object.entries(saved.accounts));
      if (saved.delegations) this.delegations = new Map(Object.entries(saved.delegations));
    }
  }

  private persist(): void {
    if (!this.stateFile) return;
    writeFileSync(
      this.stateFile,
      JSON.stringify({
        accounts: Object.fromEntries(this.accounts),
        delegations: Object.fromEntries(this.delegations),
      }),
    );
  }

  delegationInfo(id: string): { total: number; spent: number; nextSeq: number; revoked: boolean } | null {
    const d = this.delegations.get(id);
    return d ? { total: d.total, spent: d.spent, nextSeq: d.nextSeq, revoked: d.revoked } : null;
  }

  setCommittee(committee: string[], quorum: number): void {
    this.committee = committee;
    this.quorum = quorum;
  }

  // Genesis only — production issuance is a Plane-2 governance question.
  fund(address: string, amount: number): void {
    const existing = this.accounts.get(address);
    this.accounts.set(address, {
      balance: (existing?.balance ?? 0) + amount,
      nextSeq: existing?.nextSeq ?? 0,
      pending: existing?.pending,
    });
    this.persist();
  }

  balanceOf(address: string): number {
    return this.accounts.get(address)?.balance ?? 0;
  }

  accountInfo(address: string): { balance: number; nextSeq: number } {
    const a = this.accounts.get(address);
    return { balance: a?.balance ?? 0, nextSeq: a?.nextSeq ?? 0 };
  }

  stats(): { name: string; accounts: number; settled: number; volume: number } {
    return {
      name: this.name,
      accounts: this.accounts.size,
      settled: this.settledCount,
      volume: this.volume,
    };
  }

  recentActivity(): typeof this.recent {
    return this.recent;
  }

  handle = async (msg: unknown): Promise<unknown> => {
    const m = msg as Message;
    if (m.type === 'order') return this.handleOrder(m.signedOrder);
    if (m.type === 'certificate') return this.handleCertificate(m.certificate);
    if (m.type === 'register-delegation') return this.registerDelegation(m.signedAllowance);
    if (m.type === 'revoke-delegation') return this.revokeDelegation(m.signedRevoke);
    return { ok: false, error: 'unknown message type' };
  };

  // A principal registers an allowance. Only the principal can create one against its
  // own account, so the grant must carry the principal's signature.
  registerDelegation(signed: SignedAllowance): { ok: boolean; error?: string } {
    const { allowance, principalSignature } = signed;
    if (!verify(allowance.principal, canonical(allowance), principalSignature))
      return { ok: false, error: 'bad principal signature' };
    const existing = this.delegations.get(allowance.id);
    if (existing) return { ok: true }; // idempotent; grant is immutable
    this.delegations.set(allowance.id, {
      principal: allowance.principal,
      agent: allowance.agent,
      total: allowance.total,
      maxPerPayment: allowance.maxPerPayment,
      expiresAt: allowance.expiresAt,
      spent: 0,
      nextSeq: 0,
      revoked: false,
    });
    this.persist();
    return { ok: true };
  }

  // Revocation is enforced by the authorities themselves — so a revoked credential
  // cannot be spent even against an offline merchant that never saw the revocation.
  revokeDelegation(signed: SignedRevoke): { ok: boolean; error?: string } {
    const { revoke, principalSignature } = signed;
    const d = this.delegations.get(revoke.delegation);
    if (!d) return { ok: false, error: 'unknown delegation' };
    if (revoke.principal !== d.principal)
      return { ok: false, error: 'only the principal may revoke' };
    if (!verify(revoke.principal, canonical(revoke), principalSignature))
      return { ok: false, error: 'bad principal signature' };
    d.revoked = true;
    this.persist();
    return { ok: true };
  }

  protected handleOrder(signedOrder: SignedOrder): OrderResponse {
    const { order, senderSignature } = signedOrder;
    const orderBytes = canonical(order);

    if (!verify(order.sender, orderBytes, senderSignature))
      return { ok: false, error: 'bad sender signature' };
    if (!Number.isInteger(order.amount) || order.amount <= 0)
      return { ok: false, error: 'bad amount' };

    let bucket = this.buckets.get(order.sender);
    if (!bucket) this.buckets.set(order.sender, (bucket = new TokenBucket()));
    if (!bucket.tryConsume()) return { ok: false, error: 'rate limited' };

    // Delegated payment: enforce the allowance, drawing on the principal's funds. The
    // agent need not hold its own account — it spends the principal's, within the budget.
    if (order.delegation !== undefined) return this.handleDelegatedOrder(signedOrder);

    const account = this.accounts.get(order.sender);
    if (!account) return { ok: false, error: 'unknown sender' };

    if (order.seq < account.nextSeq) return { ok: false, error: 'stale sequence' };
    if (order.seq > account.nextSeq) return { ok: false, error: 'future sequence' };
    if (account.pending) {
      // Same order again → re-sign (idempotent under retries). Different order at the
      // same seq → refuse: this lock is what makes conflicting quorums impossible.
      if (canonical(account.pending.order) !== orderBytes)
        return { ok: false, error: 'conflicting order pending at this sequence' };
    } else {
      if (account.balance < order.amount) return { ok: false, error: 'insufficient balance' };
      account.pending = signedOrder;
      this.persist(); // the lock must survive a restart, or safety breaks
    }

    return {
      ok: true,
      signature: {
        authority: this.keys.publicKey,
        signature: sign(this.keys.privateKey, orderBytes),
      },
    };
  }

  // The heart of server-enforced delegation. A signed credential proves the principal
  // GRANTED a budget; it does not track how much is already spent. The authorities hold
  // that mutable state, so an agent cannot exceed its allowance by presenting the same
  // credential to many merchants — every payment is checked against the live `spent`
  // total and serialised by the delegation's own sequence number.
  private handleDelegatedOrder(signedOrder: SignedOrder): OrderResponse {
    const { order } = signedOrder;
    const orderBytes = canonical(order);
    const d = this.delegations.get(order.delegation!);
    if (!d) return { ok: false, error: 'unknown delegation' };
    if (d.revoked) return { ok: false, error: 'delegation revoked' };
    if (Date.now() > Date.parse(d.expiresAt)) return { ok: false, error: 'delegation expired' };
    if (order.sender !== d.agent) return { ok: false, error: 'not the delegated agent' };
    if (order.amount > d.maxPerPayment) return { ok: false, error: 'exceeds per-payment cap' };
    if (order.seq < d.nextSeq) return { ok: false, error: 'stale delegation sequence' };
    if (order.seq > d.nextSeq) return { ok: false, error: 'future delegation sequence' };
    if (d.pending) {
      if (canonical(d.pending.order) !== orderBytes)
        return { ok: false, error: 'conflicting order pending at this delegation sequence' };
    } else {
      if (d.spent + order.amount > d.total) return { ok: false, error: 'delegation allowance exhausted' };
      const principal = this.accounts.get(d.principal);
      if (!principal || principal.balance < order.amount)
        return { ok: false, error: 'insufficient principal balance' };
      d.pending = signedOrder;
      this.persist();
    }
    return {
      ok: true,
      signature: {
        authority: this.keys.publicKey,
        signature: sign(this.keys.privateKey, orderBytes),
      },
    };
  }

  protected handleCertificate(certificate: Certificate): SettleResponse {
    const { order, senderSignature, authoritySignatures } = certificate;
    const orderBytes = canonical(order);

    if (!verify(order.sender, orderBytes, senderSignature))
      return { ok: false, error: 'bad sender signature' };

    const validSigners = new Set<string>();
    for (const { authority, signature } of authoritySignatures) {
      if (this.committee.includes(authority) && verify(authority, orderBytes, signature))
        validSigners.add(authority);
    }
    if (validSigners.size < this.quorum)
      return { ok: false, error: `quorum not met (${validSigners.size}/${this.quorum})` };

    // Delegated settlement: debit the principal, credit the recipient, and advance the
    // allowance's spent total and sequence — the state that makes over-spend impossible.
    let debitedFrom = order.sender;
    if (order.delegation !== undefined) {
      const d = this.delegations.get(order.delegation);
      if (!d) return { ok: false, error: 'unknown delegation' };
      if (order.seq < d.nextSeq) return { ok: true }; // already settled — idempotent
      if (order.seq > d.nextSeq) return { ok: false, error: 'delegation sequence gap' };
      const principal = this.accounts.get(d.principal);
      if (!principal) return { ok: false, error: 'unknown principal' };
      principal.balance -= order.amount;
      d.spent += order.amount;
      d.nextSeq += 1;
      d.pending = undefined;
      debitedFrom = d.principal;
    } else {
      const sender = this.accounts.get(order.sender);
      if (!sender) return { ok: false, error: 'unknown sender' };
      if (order.seq < sender.nextSeq) return { ok: true }; // already settled — idempotent
      if (order.seq > sender.nextSeq)
        return { ok: false, error: 'sequence gap (authority behind)' };
      sender.balance -= order.amount;
      sender.nextSeq += 1;
      sender.pending = undefined;
    }

    const recipient = this.accounts.get(order.recipient) ?? { balance: 0, nextSeq: 0 };
    recipient.balance += order.amount;
    this.accounts.set(order.recipient, recipient);
    this.persist();

    this.settledCount += 1;
    this.volume += order.amount;
    this.recent.unshift({
      from: debitedFrom.slice(16, 24),
      to: order.recipient.slice(16, 24),
      amount: order.amount,
      ref: order.ref,
      at: Date.now(),
    });
    if (this.recent.length > 50) this.recent.pop();
    return { ok: true };
  }
}

// A Byzantine authority for the demo: signs anything, keeps no locks. The point of the
// demo is that even with it on the committee, a double-spend still cannot certify.
export class EquivocatingAuthority extends Authority {
  protected override handleOrder(signedOrder: SignedOrder): OrderResponse {
    return {
      ok: true,
      signature: {
        authority: this.keys.publicKey,
        signature: sign(this.keys.privateKey, canonical(signedOrder.order)),
      },
    };
  }
}
