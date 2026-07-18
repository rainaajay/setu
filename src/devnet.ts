// Long-running local devnet: 4 persistent authorities. Run: node src/devnet.ts
// Committee keys are generated once and reused; balances survive restarts
// (state in ./state/auth-N.json). Stop with Ctrl+C.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { COMMITTEE_PATH, generateCommittee, type CommitteeFile } from './keygen.ts';

const srcDir = dirname(fileURLToPath(import.meta.url));
const committee: CommitteeFile = existsSync(COMMITTEE_PATH)
  ? JSON.parse(readFileSync(COMMITTEE_PATH, 'utf8'))
  : generateCommittee();

const children: ChildProcess[] = [];
for (const m of committee.members) {
  const child = spawn(process.execPath, [join(srcDir, 'authority-server.ts'), m.name], {
    stdio: 'inherit',
    env: { ...process.env, SETU_STATE_DIR: join(srcDir, '..', 'state') },
  });
  children.push(child);
}

console.log('devnet up — 4 authorities on 127.0.0.1:7101-7104, persistent state in ./state');
console.log('wallet usage: node src/wallet.ts new <name> | fund <name> <amount> | pay <from> <to> <amount> | balance <name>');

process.on('SIGINT', () => {
  children.forEach((c) => c.kill());
  process.exit(0);
});
