// A Setu authority as a standalone OS process. Usage: node src/authority-server.ts auth-1
// Config (env):
//   SETU_COMMITTEE  path to committee.json     (default: ./committee.json)
//   SETU_STATE_DIR  dir for persistent state   (default: none — in-memory)
//   PORT            listen port                (default: the port in committee.json)
//   HOST            bind address               (default: 127.0.0.1; cloud: 0.0.0.0)
// Endpoints:
//   POST /            protocol messages (order / certificate)
//   POST /admin/fund  genesis funding — devnet only, would not exist in production
//   GET  /health      liveness probe
//   GET  /account?address=...  balance + next sequence number from this authority
import { createServer, type IncomingMessage } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Authority } from './authority.ts';
import { importKeyPair } from './crypto.ts';
import { COMMITTEE_PATH, type CommitteeFile } from './keygen.ts';

const name = process.argv[2] ?? process.env.SETU_AUTHORITY;
if (!name) {
  console.error('usage: node src/authority-server.ts <authority-name> (or set SETU_AUTHORITY)');
  process.exit(1);
}

const committeePath = process.env.SETU_COMMITTEE ?? COMMITTEE_PATH;
const committee: CommitteeFile = JSON.parse(readFileSync(committeePath, 'utf8'));
const me = committee.members.find((m) => m.name === name);
if (!me) {
  console.error(`${name} not in ${committeePath}`);
  process.exit(1);
}

let stateFile: string | undefined;
if (process.env.SETU_STATE_DIR) {
  mkdirSync(process.env.SETU_STATE_DIR, { recursive: true });
  stateFile = join(process.env.SETU_STATE_DIR, `${name}.json`);
}

const privateKeyB64 = process.env.SETU_PRIVATE_KEY ?? me.privateKey;
if (!privateKeyB64) {
  console.error(`no private key for ${name}: set SETU_PRIVATE_KEY or include it in the committee file`);
  process.exit(1);
}

const authority = new Authority(name, importKeyPair(me.publicKey, privateKeyB64), stateFile);
authority.setCommittee(
  committee.members.map((m) => m.publicKey),
  committee.quorum,
);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const port = Number(process.env.PORT ?? me.port);
const host = process.env.HOST ?? '127.0.0.1';

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${host}:${port}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS).end();
    return;
  }
  try {
    let payload: unknown;
    if (req.method === 'GET' && url.pathname === '/health') {
      payload = { ok: true, name };
    } else if (req.method === 'GET' && url.pathname === '/account') {
      payload = authority.accountInfo(url.searchParams.get('address') ?? '');
    } else if (req.method === 'GET' && url.pathname === '/committee') {
      // public keys + quorum — not secret; lets any client verify certificates offline
      payload = {
        quorum: committee.quorum,
        publicKeys: committee.members.map((m) => m.publicKey),
      };
    } else if (req.method === 'GET' && url.pathname === '/stats') {
      payload = authority.stats();
    } else if (req.method === 'GET' && url.pathname === '/recent') {
      payload = authority.recentActivity();
    } else if (req.method === 'GET' && url.pathname === '/balance') {
      payload = { balance: authority.balanceOf(url.searchParams.get('address') ?? '') };
    } else if (req.method === 'POST' && url.pathname === '/admin/fund') {
      const { address, amount } = JSON.parse(await readBody(req));
      authority.fund(address, amount);
      payload = { ok: true };
    } else if (req.method === 'POST' && url.pathname === '/') {
      payload = await authority.handle(JSON.parse(await readBody(req)));
    } else {
      res.writeHead(404, CORS).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', ...CORS });
    res.end(JSON.stringify(payload));
  } catch (e) {
    res.writeHead(400, { 'content-type': 'application/json', ...CORS });
    res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
  }
});

server.listen(port, host, () => {
  console.log(`${name} listening on ${host}:${port}${stateFile ? ` (state: ${stateFile})` : ' (in-memory)'}`);
});
