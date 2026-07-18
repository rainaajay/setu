// The single crypto seam. Everything above this file treats keys and signatures as
// opaque strings, so swapping ed25519 for a post-quantum scheme (SPEC.md v0.5) means
// changing only this module.
import {
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  createPublicKey,
  createPrivateKey,
  type KeyObject,
} from 'node:crypto';

export interface KeyPair {
  publicKey: string; // base64 DER (SPKI) — doubles as the address
  privateKey: KeyObject;
}

export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey,
  };
}

// Persistence for multi-process deployments (authority-server.ts). Same seam rule:
// nothing outside this file knows the encoding.
export function exportPrivateKey(privateKey: KeyObject): string {
  return privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
}

export function importKeyPair(publicKey: string, privateKeyB64: string): KeyPair {
  return {
    publicKey,
    privateKey: createPrivateKey({
      key: Buffer.from(privateKeyB64, 'base64'),
      type: 'pkcs8',
      format: 'der',
    }),
  };
}

export function sign(privateKey: KeyObject, message: string): string {
  return nodeSign(null, Buffer.from(message), privateKey).toString('base64');
}

export function verify(publicKey: string, message: string, signature: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      type: 'spki',
      format: 'der',
    });
    return nodeVerify(null, Buffer.from(message), key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

// Canonical serialization: sorted keys, so signer and verifier always hash identical bytes.
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

export function shortId(address: string): string {
  return address.slice(16, 24);
}
