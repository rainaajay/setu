// Helpers to build the signed grant and revocation a principal sends to the authorities.
// The authorities hold the mutable spend state (see authority.ts); these objects are the
// immutable, signed instructions that create and cancel an allowance.
import { canonical, sign, type KeyPair } from '../crypto.ts';
import type { DelegationAllowance, SignedAllowance, SignedRevoke } from '../types.ts';

export function signAllowance(
  principal: KeyPair,
  allowance: Omit<DelegationAllowance, 'principal'>,
): SignedAllowance {
  const full: DelegationAllowance = { ...allowance, principal: principal.publicKey };
  return { allowance: full, principalSignature: sign(principal.privateKey, canonical(full)) };
}

export function signRevoke(principal: KeyPair, delegation: string): SignedRevoke {
  const revoke = { delegation, principal: principal.publicKey };
  return { revoke, principalSignature: sign(principal.privateKey, canonical(revoke)) };
}
