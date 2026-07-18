import { canonical, generateKeyPair, sign, type KeyPair } from './crypto.ts';
import type { Network } from './network.ts';
import type {
  AuthoritySignature,
  Certificate,
  OrderResponse,
  SettleResponse,
  TransferOrder,
} from './types.ts';

export interface TransferResult {
  certificate: Certificate;
  latencyMs: number; // order sent → certificate formed (the finality event)
  settledOn: number; // authorities that applied the certificate
}

export class Wallet {
  readonly keys: KeyPair;
  private nextSeq = 0;

  readonly name: string;
  private network: Network;
  private authorityIds: string[];
  private quorum: number;

  constructor(
    name: string,
    network: Network,
    authorityIds: string[],
    quorum: number,
    keys?: KeyPair,
  ) {
    this.name = name;
    this.network = network;
    this.authorityIds = authorityIds;
    this.quorum = quorum;
    this.keys = keys ?? generateKeyPair();
  }

  get address(): string {
    return this.keys.publicKey;
  }

  async transfer(recipient: string, amount: number): Promise<TransferResult> {
    const result = await this.sendOrder(recipient, amount, this.nextSeq, this.authorityIds);
    this.nextSeq += 1;
    return result;
  }

  // Low-level path used by the demo's adversarial scenarios: pick the seq and the
  // subset of authorities explicitly (an equivocating client does exactly this).
  async sendOrder(
    recipient: string,
    amount: number,
    seq: number,
    targets: string[],
    ref?: string,
    delegation?: string,
  ): Promise<TransferResult> {
    const order: TransferOrder = { sender: this.address, recipient, amount, seq };
    if (ref !== undefined) order.ref = ref;
    if (delegation !== undefined) order.delegation = delegation;
    const signedOrder = { order, senderSignature: sign(this.keys.privateKey, canonical(order)) };

    const started = performance.now();
    const responses = await Promise.allSettled(
      targets.map((id) => this.network.send(id, { type: 'order', signedOrder })),
    );

    const signatures: AuthoritySignature[] = [];
    const errors: string[] = [];
    for (const r of responses) {
      if (r.status === 'rejected') {
        errors.push(String(r.reason?.message ?? r.reason));
        continue;
      }
      const resp = r.value as OrderResponse;
      if (resp.ok) signatures.push(resp.signature);
      else errors.push(resp.error);
    }

    if (signatures.length < this.quorum)
      throw new Error(
        `no quorum: ${signatures.length}/${this.quorum} signatures (${errors.join('; ')})`,
      );

    const certificate: Certificate = {
      order,
      senderSignature: signedOrder.senderSignature,
      authoritySignatures: signatures.slice(0, this.quorum),
    };
    const latencyMs = performance.now() - started; // certificate formed = final

    const settles = await Promise.allSettled(
      this.authorityIds.map((id) => this.network.send(id, { type: 'certificate', certificate })),
    );
    const settledOn = settles.filter(
      (r) => r.status === 'fulfilled' && (r.value as SettleResponse).ok,
    ).length;

    return { certificate, latencyMs, settledOn };
  }
}
