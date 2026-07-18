// Human → agent delegation as a Plane 2 attestation. The principal's key signs a
// claim naming the agent's address and its spending policy. Because ops are signed and
// content-addressed, the delegation is a portable verifiable credential: any merchant
// can check it offline — no registry, no server.
import { makeOp, verifyOp, type SignedOp } from '../trust/op.ts';
import type { KeyPair } from '../crypto.ts';

export interface SpendPolicy {
  type: 'delegation';
  budget: number; // total units the agent may spend under this delegation
  maxPerPayment: number;
  expiresAt: string; // ISO timestamp
}

export function createDelegation(
  principal: KeyPair,
  agentAddress: string,
  policy: Omit<SpendPolicy, 'type'>,
): SignedOp {
  return makeOp(
    principal,
    'attest',
    { subject: agentAddress, claim: JSON.stringify({ type: 'delegation', ...policy }) },
    [],
  );
}

export function verifyDelegation(
  op: SignedOp,
  agentAddress: string,
): { principal: string; policy: SpendPolicy } | { error: string } {
  if (!verifyOp(op)) return { error: 'bad delegation signature' };
  if (op.body.kind !== 'attest' || op.body.payload.subject !== agentAddress)
    return { error: 'delegation does not name this agent' };
  let policy: SpendPolicy;
  try {
    policy = JSON.parse(op.body.payload.claim);
  } catch {
    return { error: 'unparseable delegation claim' };
  }
  if (policy.type !== 'delegation') return { error: 'not a delegation claim' };
  if (new Date(policy.expiresAt).getTime() < Date.now()) return { error: 'delegation expired' };
  return { principal: op.body.author, policy };
}
