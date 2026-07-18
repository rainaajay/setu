// setu-pay — the whole client SDK for the Setu settlement network, in one file, zero deps.
// A wallet pays; a merchant charges and verifies. Payments are final in one round trip,
// with no blockchain and no fee. See https://setu-mocha.vercel.app.
//
//   import { SetuWallet, SetuMerchant, MAINNET } from 'setu-pay';
//   const w = await SetuWallet.create(MAINNET);
//   await w.faucet();                       // testnet only
//   const receipt = await w.pay(recipient, 5, 'invoice-123');
//
// Everything below uses only Web-standard APIs (WebCrypto, fetch), so the identical code
// runs in Node ≥ 20, Deno, Bun, and the browser.

export interface Committee {
  authorities: string[]; // base URLs
  publicKeys?: string[]; // committee public keys — needed only to verify certificates offline
  quorum: number;
}

// The live network. publicKeys are fetched lazily on first verify() if not supplied.
export const MAINNET: Committee = {
  authorities: [
    'https://setu-auth-1.fly.dev',
    'https://setu-auth-2.fly.dev',
    'https://setu-auth-3.fly.dev',
    'https://setu-auth-4.fly.dev',
  ],
  quorum: 3,
};

export interface TransferOrder {
  sender: string;
  recipient: string;
  amount: number;
  seq: number;
  ref?: string;
}
export interface Certificate {
  order: TransferOrder;
  senderSignature: string;
  authoritySignatures: { authority: string; signature: string }[];
}
export interface Receipt {
  certificate: Certificate;
  latencyMs: number;
  settledOn: number;
}

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Canonical JSON (sorted keys) — signer and verifier must hash identical bytes.
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

async function importPublic(spkiB64: string): Promise<CryptoKey> {
  return subtle.importKey('spki', unb64(spkiB64), 'Ed25519', true, ['verify']);
}

/** Verify a settlement certificate offline, given the committee's public keys. */
export async function verifyCertificate(
  certificate: Certificate,
  committee: Committee,
): Promise<{ valid: true } | { valid: false; error: string }> {
  const keys = committee.publicKeys ?? (await fetchCommitteeKeys(committee));
  const bytes = enc.encode(canonical(certificate.order));
  const senderKey = await importPublic(certificate.order.sender);
  if (!(await subtle.verify('Ed25519', senderKey, unb64(certificate.senderSignature), bytes)))
    return { valid: false, error: 'bad sender signature' };
  const signers = new Set<string>();
  for (const { authority, signature } of certificate.authoritySignatures) {
    if (!keys.includes(authority)) continue;
    const k = await importPublic(authority);
    if (await subtle.verify('Ed25519', k, unb64(signature), bytes)) signers.add(authority);
  }
  return signers.size >= committee.quorum
    ? { valid: true }
    : { valid: false, error: `quorum not met (${signers.size}/${committee.quorum})` };
}

async function fetchCommitteeKeys(committee: Committee): Promise<string[]> {
  // Derive the committee public keys from a quorum of authorities that agree.
  const seen = new Map<string, number>();
  await Promise.all(
    committee.authorities.map(async (url) => {
      try {
        const info = await (await fetch(url + '/committee')).json();
        for (const k of info.publicKeys as string[]) seen.set(k, (seen.get(k) ?? 0) + 1);
      } catch {}
    }),
  );
  return [...seen.entries()].filter(([, n]) => n >= committee.quorum).map(([k]) => k);
}

export class SetuWallet {
  private committee: Committee;
  private privateKey: CryptoKey;
  readonly address: string;

  private constructor(committee: Committee, privateKey: CryptoKey, address: string) {
    this.committee = committee;
    this.privateKey = privateKey;
    this.address = address;
  }

  /** Create a fresh wallet (keys generated locally, never leave the device). */
  static async create(committee: Committee = MAINNET): Promise<SetuWallet> {
    const kp = (await subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
    const address = b64(await subtle.exportKey('spki', kp.publicKey));
    return new SetuWallet(committee, kp.privateKey, address);
  }

  /** Serialize the private key to a secret string. Store it with the address (below);
   *  WebCrypto can't recover a public key from a pkcs8 private key, so load() needs both. */
  async export(): Promise<{ secret: string; address: string }> {
    return { secret: b64(await subtle.exportKey('pkcs8', this.privateKey)), address: this.address };
  }
  static async load(
    saved: { secret: string; address: string },
    committee: Committee = MAINNET,
  ): Promise<SetuWallet> {
    const privateKey = await subtle.importKey('pkcs8', unb64(saved.secret), 'Ed25519', false, [
      'sign',
    ]);
    return new SetuWallet(committee, privateKey, saved.address);
  }

  private async each<T>(fn: (url: string) => Promise<T>): Promise<(T | null)[]> {
    return Promise.all(
      this.committee.authorities.map((u) => fn(u).catch(() => null as T | null)),
    );
  }

  /** Balance as agreed by a majority of authorities. */
  async balance(): Promise<number> {
    const views = (await this.each(async (url) =>
      (await fetch(`${url}/account?address=${encodeURIComponent(this.address)}`, {
        signal: AbortSignal.timeout(8000),
      }).then((r) => r.json())) as { balance: number },
    )).filter(Boolean) as { balance: number }[];
    if (!views.length) throw new Error('network unreachable');
    const tally = new Map<number, number>();
    for (const v of views) tally.set(v.balance, (tally.get(v.balance) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  /** Request test units from the faucet (testnet only). */
  async faucet(amount = 500): Promise<void> {
    await this.each((url) =>
      fetch(`${url}/admin/fund`, { method: 'POST', body: JSON.stringify({ address: this.address, amount }) }),
    );
  }

  private async networkSeq(): Promise<number> {
    const seqs = (await this.each(async (url) =>
      ((await fetch(`${url}/account?address=${encodeURIComponent(this.address)}`, {
        signal: AbortSignal.timeout(8000),
      }).then((r) => r.json())) as { nextSeq: number }).nextSeq,
    )).filter((s): s is number => typeof s === 'number');
    if (!seqs.length) throw new Error('network unreachable');
    return Math.max(...seqs);
  }

  /** Pay a recipient. Resolves when the payment is final (quorum certificate formed). */
  async pay(recipient: string, amount: number, ref?: string): Promise<Receipt> {
    const seq = await this.networkSeq();
    const order: TransferOrder = { sender: this.address, recipient, amount, seq };
    if (ref !== undefined) order.ref = ref;
    const senderSignature = b64(await subtle.sign('Ed25519', this.privateKey, enc.encode(canonical(order))));

    const t0 = performance.now();
    const responses = (await this.each(async (url) =>
      (await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'order', signedOrder: { order, senderSignature } }),
        signal: AbortSignal.timeout(8000),
      }).then((r) => r.json())) as { ok: boolean; signature?: unknown; error?: string },
    ));
    const sigs = responses.filter((r) => r?.ok).map((r) => r!.signature);
    if (sigs.length < this.committee.quorum) {
      const errs = responses.filter((r) => r && !r.ok).map((r) => r!.error);
      throw new Error(`payment not final: ${sigs.length}/${this.committee.quorum} signatures (${errs.join('; ')})`);
    }
    const certificate: Certificate = {
      order,
      senderSignature,
      authoritySignatures: sigs.slice(0, this.committee.quorum) as Certificate['authoritySignatures'],
    };
    const latencyMs = performance.now() - t0;
    const settles = await this.each((url) =>
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'certificate', certificate }) }).then((r) => r.json()),
    );
    return { certificate, latencyMs, settledOn: settles.filter((s) => (s as { ok: boolean } | null)?.ok).length };
  }
}

/** A merchant charges for a resource and verifies incoming payments. */
export class SetuMerchant {
  private invoices = new Map<string, { price: number; resource: string }>();
  private redeemed = new Set<string>();
  readonly address: string;
  private committee: Committee;
  constructor(address: string, committee: Committee = MAINNET) {
    this.address = address;
    this.committee = committee;
  }

  /** Issue an invoice for a resource at a price. Returns what to send the buyer as a 402. */
  invoice(resource: string, price: number): { id: string; price: number; payTo: string } {
    const id = crypto.randomUUID();
    this.invoices.set(id, { price, resource });
    return { id, price, payTo: this.address };
  }

  /** Verify a buyer's payment certificate against an invoice. Single-use. */
  async settle(
    invoiceId: string,
    certificate: Certificate,
  ): Promise<{ ok: true; resource: string; payer: string } | { ok: false; error: string }> {
    const inv = this.invoices.get(invoiceId);
    if (!inv) return { ok: false, error: 'unknown invoice' };
    if (this.redeemed.has(invoiceId)) return { ok: false, error: 'invoice already redeemed' };
    const v = await verifyCertificate(certificate, this.committee);
    if (!v.valid) return { ok: false, error: v.error };
    if (certificate.order.ref !== invoiceId) return { ok: false, error: 'certificate not for this invoice' };
    if (certificate.order.recipient !== this.address) return { ok: false, error: 'paid to wrong address' };
    if (certificate.order.amount < inv.price) return { ok: false, error: 'underpaid' };
    this.redeemed.add(invoiceId);
    return { ok: true, resource: inv.resource, payer: certificate.order.sender };
  }
}
