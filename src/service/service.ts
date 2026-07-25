// A priced digital service (brief §11/§13/§14/§15). It issues signed quotes, and before
// delivering it verifies settlement SERVER-SIDE against the committee keys — never trusting a
// client "success" message. Settlement and fulfilment are tracked as separate states.
import { createHash } from 'node:crypto';
import { generateKeyPair, type KeyPair } from '../crypto.ts';
import { verifyCertificate } from '../certificates.ts';
import { signQuote, type SignedQuote } from './quote.ts';
import type { Certificate } from '../types.ts';

export type Settlement = 'not-submitted' | 'quorum-reached' | 'failed';
export type Fulfilment = 'not-started' | 'completed' | 'failed';

export interface RedeemResult {
  settlement: Settlement;
  fulfilment: Fulfilment;
  result?: string;
  reason?: string;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export class SetuService {
  readonly keys: KeyPair;
  readonly address: string;
  readonly id: string;
  readonly name: string;
  readonly capability: string;
  readonly price: number;
  readonly unit: string;
  private fulfilFn: (task: string) => string;
  private redeemed = new Set<string>();

  constructor(id: string, name: string, capability: string, price: number, fulfilFn: (task: string) => string, unit = 'Setu Credit') {
    this.id = id; this.name = name; this.capability = capability; this.price = price;
    this.fulfilFn = fulfilFn; this.unit = unit;
    this.keys = generateKeyPair();
    this.address = this.keys.publicKey;
  }

  quote(task: string, ttlMs = 60_000, now: number = Date.now()): SignedQuote {
    const quote = {
      id: 'q_' + sha(this.id + task + now).slice(0, 16),
      service: this.id,
      capability: this.capability,
      taskHash: sha(task),
      price: this.price,
      unit: this.unit,
      payTo: this.address,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      version: 1,
    };
    return signQuote(this.keys, quote);
  }

  // Verify the certificate settles THIS quote to THIS service for at least the price, that the
  // task matches, and that it has not already been redeemed. Only then fulfil.
  redeem(sq: SignedQuote, certificate: Certificate, committee: string[], quorum: number, task: string): RedeemResult {
    const v = verifyCertificate(certificate, committee, quorum);
    if (!v.valid) return { settlement: 'failed', fulfilment: 'not-started', reason: v.error };
    const o = certificate.order;
    if (o.ref !== sq.quote.id) return { settlement: 'failed', fulfilment: 'not-started', reason: 'certificate not for this quote' };
    if (o.recipient !== this.address) return { settlement: 'failed', fulfilment: 'not-started', reason: 'paid to wrong address' };
    if (o.amount < sq.quote.price) return { settlement: 'failed', fulfilment: 'not-started', reason: 'underpaid' };
    // Settlement is valid from here on; fulfilment is a separate concern.
    if (this.redeemed.has(sq.quote.id)) return { settlement: 'quorum-reached', fulfilment: 'failed', reason: 'quote already redeemed' };
    if (sha(task) !== sq.quote.taskHash) return { settlement: 'quorum-reached', fulfilment: 'failed', reason: 'task does not match quote' };
    this.redeemed.add(sq.quote.id);
    try {
      return { settlement: 'quorum-reached', fulfilment: 'completed', result: this.fulfilFn(task) };
    } catch (e) {
      return { settlement: 'quorum-reached', fulfilment: 'failed', reason: (e as Error).message };
    }
  }
}
