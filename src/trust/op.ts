// Plane 2 primitive: the signed, content-addressed operation (Kleppmann PaPoC'22 model).
// Every op names its causal predecessors by hash, so the op set forms a hash-DAG:
// - signatures make forgery impossible (you can't author ops as someone else)
// - content addressing makes tampering self-evident (hash changes)
// - equivocation is harmless: both ops just become concurrent DAG branches that every
//   honest peer merges identically
import { createHash } from 'node:crypto';
import { canonical, sign, verify, type KeyPair } from '../crypto.ts';

export type OpKind = 'profile' | 'attest' | 'revoke';

export interface OpBody {
  author: string; // public key — same identity space as Plane 1 wallets
  kind: OpKind;
  payload: Record<string, string>;
  deps: string[]; // hashes of the author's view of the DAG heads at creation time
}

export interface SignedOp {
  body: OpBody;
  signature: string;
}

export function opHash(body: OpBody): string {
  return createHash('sha256').update(canonical(body)).digest('hex');
}

export function makeOp(
  keys: KeyPair,
  kind: OpKind,
  payload: Record<string, string>,
  deps: string[],
): SignedOp {
  const body: OpBody = { author: keys.publicKey, kind, payload, deps: [...deps].sort() };
  return { body, signature: sign(keys.privateKey, canonical(body)) };
}

export function verifyOp(op: SignedOp): boolean {
  return verify(op.body.author, canonical(op.body), op.signature);
}
