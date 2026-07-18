// Generates committee.json: 4 authority keypairs + ports + quorum. Demo/devnet only —
// in production each authority generates its own key and only public keys are shared.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateKeyPair, exportPrivateKey } from './crypto.ts';

export interface CommitteeMember {
  name: string;
  port: number;
  url?: string; // public base URL when deployed (e.g. https://setu-auth-1.fly.dev)
  publicKey: string;
  privateKey?: string; // pkcs8 base64 — local devnet only; deployed authorities get
  // their key via the SETU_PRIVATE_KEY secret and the committee file stays public-only
}

export interface CommitteeFile {
  quorum: number;
  members: CommitteeMember[];
}

export const COMMITTEE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'committee.json');

export function memberUrl(m: CommitteeMember): string {
  return m.url ?? `http://127.0.0.1:${m.port}`;
}

export function generateCommittee(filePath: string = COMMITTEE_PATH, basePort = 7100): CommitteeFile {
  const members: CommitteeMember[] = [1, 2, 3, 4].map((i) => {
    const keys = generateKeyPair();
    return {
      name: `auth-${i}`,
      port: basePort + i,
      publicKey: keys.publicKey,
      privateKey: exportPrivateKey(keys.privateKey),
    };
  });
  const committee: CommitteeFile = { quorum: 3, members };
  writeFileSync(filePath, JSON.stringify(committee, null, 2));
  return committee;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  generateCommittee();
  console.log(`wrote ${COMMITTEE_PATH}`);
}
