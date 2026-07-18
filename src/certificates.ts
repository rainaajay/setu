// Standalone certificate verification: anyone (a merchant agent, an auditor, a browser)
// can verify a Setu payment certificate offline with only the committee's public keys.
// This is the whole point of quorum certificates — verification needs no trusted server.
import { canonical, verify } from './crypto.ts';
import type { Certificate } from './types.ts';

export function verifyCertificate(
  certificate: Certificate,
  committee: string[],
  quorum: number,
): { valid: true } | { valid: false; error: string } {
  const { order, senderSignature, authoritySignatures } = certificate;
  const orderBytes = canonical(order);
  if (!verify(order.sender, orderBytes, senderSignature))
    return { valid: false, error: 'bad sender signature' };
  const signers = new Set<string>();
  for (const { authority, signature } of authoritySignatures) {
    if (committee.includes(authority) && verify(authority, orderBytes, signature))
      signers.add(authority);
  }
  if (signers.size < quorum)
    return { valid: false, error: `quorum not met (${signers.size}/${quorum})` };
  return { valid: true };
}
