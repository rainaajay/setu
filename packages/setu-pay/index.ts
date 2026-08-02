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
    // Extractable = true so a restored wallet can be re-exported (export()) and saved again. Without
    // it, a service that persists wallets (setu-economy) survives ONE restart then can never save
    // again ("key is not extractable"), silently falling back to genesis on the next restart.
    const privateKey = await subtle.importKey('pkcs8', unb64(saved.secret), 'Ed25519', true, [
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

  // Certificates this wallet has formed, so an authority that missed one can be caught up. Without
  // it the wallet BRICKS: the next order uses seq = max(nextSeq), an authority below that refuses it
  // as "future sequence", and once two of four are behind no order reaches quorum again — for good.
  private certLog = new Map<number, Certificate>();

  private async seqPerAuthority(): Promise<{ url: string; nextSeq: number }[]> {
    const out = await Promise.all(this.committee.authorities.map(async (url) => {
      try {
        const j = (await fetch(`${url}/account?address=${encodeURIComponent(this.address)}`, {
          signal: AbortSignal.timeout(8000),
        }).then((r) => r.json())) as { nextSeq: number };
        return typeof j?.nextSeq === 'number' ? { url, nextSeq: j.nextSeq } : null;
      } catch { return null; }
    }));
    return out.filter((x): x is { url: string; nextSeq: number } => !!x);
  }

  // Replay, in order, the certificates a lagging authority missed. Certificates are idempotent and
  // self-authenticating, so this needs no protocol change.
  private async catchUp(views: { url: string; nextSeq: number }[], target: number): Promise<void> {
    await Promise.all(views.map(async (v) => {
      for (let s = v.nextSeq; s < target; s++) {
        const cert = this.certLog.get(s);
        if (!cert) return;
        try {
          await fetch(v.url, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'certificate', certificate: cert }), signal: AbortSignal.timeout(8000) });
        } catch { return; }
      }
    }));
  }

  private async networkSeq(): Promise<number> {
    let views = await this.seqPerAuthority();
    if (!views.length) throw new Error('network unreachable');
    let target = Math.max(...views.map((v) => v.nextSeq));
    // Heal any laggard BEFORE signing, or it refuses the order and quorum silently becomes unreachable.
    if (views.some((v) => v.nextSeq < target)) {
      await this.catchUp(views.filter((v) => v.nextSeq < target), target);
      views = await this.seqPerAuthority();
      if (views.length) target = Math.max(...views.map((v) => v.nextSeq));
    }
    return target;
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
    this.certLog.set(seq, certificate);
    if (this.certLog.size > 50) this.certLog.delete([...this.certLog.keys()].sort((a, b) => a - b)[0]);
    const latencyMs = performance.now() - t0;
    // The payment is final once the certificate exists; applying it is separate. A settle leg that
    // fails was previously never retried, leaving that authority permanently behind — it then refuses
    // every later certificate from this sender with a sequence gap (there is no anti-entropy between
    // authorities). Retry the stragglers so the ledger converges; never delay the caller for it.
    const settleOne = async (url: string): Promise<boolean> => {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'certificate', certificate }), signal: AbortSignal.timeout(12000) });
        return !!(await r.json())?.ok;
      } catch { return false; }
    };
    const urls = this.committee.authorities;
    const ok = await Promise.all(urls.map(settleOne));
    const settledOn = ok.filter(Boolean).length;
    const missing = urls.filter((_, i) => !ok[i]);
    if (missing.length) {
      void (async () => {
        let left = missing;
        for (const delayMs of [500, 2000, 8000]) {
          if (!left.length) return;
          await new Promise((r) => setTimeout(r, delayMs));
          const res = await Promise.all(left.map(settleOne));
          left = left.filter((_, i) => !res[i]);
        }
      })().catch(() => {});
    }
    return { certificate, latencyMs, settledOn };
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
