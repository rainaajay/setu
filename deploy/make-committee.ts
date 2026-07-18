// Generates the production committee: committee-prod.json (PUBLIC keys + URLs only —
// safe to ship in the Docker image) and deploy/secrets/auth-N.key files whose contents
// go into each Fly app as the SETU_PRIVATE_KEY secret. Run once; rerunning rotates the
// committee (which invalidates deployed authorities until secrets are reset).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateKeyPair, exportPrivateKey } from '../src/crypto.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const committeePath = join(root, 'committee-prod.json');
const secretsDir = join(root, 'deploy', 'secrets');

if (existsSync(committeePath)) {
  console.log(`${committeePath} already exists — delete it first if you really want to rotate the committee`);
  process.exit(1);
}

mkdirSync(secretsDir, { recursive: true });

const REGIONS = ['lhr', 'fra', 'iad', 'sin'];
const members = REGIONS.map((region, i) => {
  const n = i + 1;
  const keys = generateKeyPair();
  writeFileSync(join(secretsDir, `auth-${n}.key`), exportPrivateKey(keys.privateKey));
  return {
    name: `auth-${n}`,
    port: 8080,
    url: `https://setu-auth-${n}.fly.dev`,
    region,
    publicKey: keys.publicKey,
  };
});

writeFileSync(committeePath, JSON.stringify({ quorum: 3, members }, null, 2));
console.log(`wrote ${committeePath} (public keys only) and 4 key files in deploy/secrets/`);
