// A Plane 2 peer: local-first replica of the identity/attestation hash-DAG.
// No committee, no quorum, no server — peers gossip ops and converge (eventual
// consistency; per SPEC.md this plane is explicitly NOT for payments).
import { createHash } from 'node:crypto';
import { canonical, generateKeyPair, type KeyPair } from '../crypto.ts';
import { makeOp, opHash, verifyOp, type OpKind, type SignedOp } from './op.ts';

export interface TrustState {
  // author → field → value
  profiles: Record<string, Record<string, string>>;
  // attestation op hash → {from, subject, claim} (revoked ones removed)
  attestations: Record<string, { from: string; subject: string; claim: string }>;
}

export class TrustPeer {
  readonly name: string;
  readonly keys: KeyPair;
  private ops = new Map<string, SignedOp>();

  constructor(name: string, keys?: KeyPair) {
    this.name = name;
    this.keys = keys ?? generateKeyPair();
  }

  get address(): string {
    return this.keys.publicKey;
  }

  // Author a new op on top of everything this peer currently knows.
  createOp(kind: OpKind, payload: Record<string, string>): SignedOp {
    const op = makeOp(this.keys, kind, payload, this.heads());
    this.receive([op]);
    return op;
  }

  // Ingest ops from anywhere. Returns per-op verdicts. Order-independent: ops whose
  // deps haven't arrived yet are retried within the batch; unresolvable ones are
  // rejected (their deps never showed up — or were tampered with, changing the hash).
  receive(incoming: SignedOp[]): { accepted: number; rejected: string[] } {
    let queue = [...incoming];
    const rejected: string[] = [];
    let accepted = 0;
    let progress = true;
    while (progress) {
      progress = false;
      const defer: SignedOp[] = [];
      for (const op of queue) {
        const hash = opHash(op.body);
        if (this.ops.has(hash)) continue; // idempotent
        if (!verifyOp(op)) {
          rejected.push(`bad signature (claimed author ${op.body.author.slice(16, 24)}…)`);
          continue;
        }
        if (!op.body.deps.every((d) => this.ops.has(d))) {
          defer.push(op); // deps may arrive later in this batch
          continue;
        }
        this.ops.set(hash, op);
        accepted++;
        progress = true;
      }
      queue = defer;
    }
    for (const _op of queue) rejected.push('missing causal dependencies');
    return { accepted, rejected };
  }

  heads(): string[] {
    const referenced = new Set<string>();
    for (const op of this.ops.values()) op.body.deps.forEach((d) => referenced.add(d));
    return [...this.ops.keys()].filter((h) => !referenced.has(h)).sort();
  }

  // Anti-entropy gossip: both sides end up with the union of verified ops.
  syncWith(other: TrustPeer): void {
    other.receive([...this.ops.values()]);
    this.receive([...other.ops.values()]);
  }

  opCount(): number {
    return this.ops.size;
  }

  // Deterministic state derivation: apply ops in (causal depth, hash) order, so every
  // peer with the same op set computes the same state. Causality is respected (a later
  // op always outranks its ancestors); concurrent writes tie-break by hash — arbitrary
  // but identical everywhere, which is what convergence requires.
  deriveState(): TrustState {
    const depths = new Map<string, number>();
    const depth = (hash: string): number => {
      const known = depths.get(hash);
      if (known !== undefined) return known;
      const op = this.ops.get(hash)!;
      const d = 1 + Math.max(0, ...op.body.deps.map(depth));
      depths.set(hash, d);
      return d;
    };
    const ordered = [...this.ops.entries()]
      .map(([hash, op]) => ({ hash, op, d: depth(hash) }))
      .sort((a, b) => a.d - b.d || (a.hash < b.hash ? -1 : 1));

    const profiles: TrustState['profiles'] = {};
    const attestations: TrustState['attestations'] = {};
    for (const { hash, op } of ordered) {
      const { author, kind, payload } = op.body;
      if (kind === 'profile') {
        (profiles[author] ??= {})[payload.field] = payload.value; // LWW in merge order
      } else if (kind === 'attest') {
        attestations[hash] = { from: author, subject: payload.subject, claim: payload.claim };
      } else if (kind === 'revoke') {
        // only the original attester may revoke their attestation
        if (attestations[payload.target]?.from === author) delete attestations[payload.target];
      }
    }
    return { profiles, attestations };
  }

  fingerprint(): string {
    return createHash('sha256').update(canonical(this.deriveState())).digest('hex').slice(0, 16);
  }

  attestationsAbout(subject: string): { from: string; claim: string }[] {
    return Object.values(this.deriveState().attestations)
      .filter((a) => a.subject === subject)
      .map(({ from, claim }) => ({ from, claim }));
  }
}
