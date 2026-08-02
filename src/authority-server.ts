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

// Per-IP hourly cap on faucet calls. The faucet stays public (test units; the browser wallet and the
// arena need it) but cannot be used to bloat state with unbounded accounts/balances.
const FAUCET_PER_IP_HOUR = Number(process.env.SETU_FAUCET_PER_IP_HOUR ?? 60);
const FAUCET_MAX = Number(process.env.SETU_FAUCET_MAX ?? 1000);              // max per faucet call
const FAUCET_MAX_BALANCE = Number(process.env.SETU_FAUCET_MAX_BALANCE ?? 100_000); // max faucet-topped balance
let faucetHour = '';
const faucetHits = new Map<string, number>();
function faucetAllowed(ip: string): boolean {
  const h = new Date().toISOString().slice(0, 13);
  if (h !== faucetHour) { faucetHour = h; faucetHits.clear(); }
  const n = (faucetHits.get(ip) ?? 0) + 1;
  faucetHits.set(ip, n);
  return n <= FAUCET_PER_IP_HOUR;
}

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
    } else if (req.method === 'GET' && url.pathname === '/digest') {
      // Anti-entropy: what sequence this authority has reached per sender, so a peer can see what it
      // is missing. Read-only and public — it exposes nothing a peer cannot already read per-account.
      payload = { name, now: Date.now(), senders: authority.digest() };
    } else if (req.method === 'GET' && url.pathname === '/certs') {
      // Serve the certificates a lagging peer needs. Certificates are self-authenticating, so this
      // grants no trust: the peer re-verifies every one through its own handleCertificate.
      const sender = url.searchParams.get('sender') ?? '';
      const from = Number(url.searchParams.get('from') ?? 0);
      const to = Number(url.searchParams.get('to') ?? 0);
      if (!sender || !Number.isInteger(from) || !Number.isInteger(to) || to <= from || to - from > 200) {
        res.writeHead(400, { 'content-type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: 'sender, from, to required; range <= 200' }));
        return;
      }
      payload = { certificates: authority.certsFor(sender, from, to) };
    } else if (req.method === 'GET' && url.pathname === '/recent') {
      payload = authority.recentActivity();
    } else if (req.method === 'GET' && url.pathname === '/balance') {
      payload = { balance: authority.balanceOf(url.searchParams.get('address') ?? '') };
    } else if (req.method === 'POST' && url.pathname === '/admin/fund') {
      // Public testnet faucet: intentionally open (Credits are test units; the browser wallet and arena
      // depend on it), but bounded — per-IP hourly rate limit here, amount/balance caps in fund().
      const ip = String(req.headers['fly-client-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown');
      if (!faucetAllowed(ip)) {
        res.writeHead(429, { 'content-type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: 'faucet rate limit reached; try again later' }));
        return;
      }
      const { address, amount } = JSON.parse(await readBody(req));
      if (!Number.isInteger(amount) || amount <= 0 || amount > FAUCET_MAX) {
        res.writeHead(400, { 'content-type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: `amount must be a positive integer <= ${FAUCET_MAX}` }));
        return;
      }
      if (authority.balanceOf(address) + amount > FAUCET_MAX_BALANCE) {
        res.writeHead(400, { 'content-type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: false, error: 'faucet balance cap reached for this address' }));
        return;
      }
      payload = authority.fund(address, amount);
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

// --- Anti-entropy -------------------------------------------------------------------------------
// Settlement application is client-driven, so an authority that misses a certificate stays behind:
// a missed OUTGOING spend makes it refuse later certificates ("sequence gap"), and a missed INCOMING
// credit diverges SILENTLY — a permanently wrong balance with no error. Client-side retries stop new
// divergence but cannot repair history. This loop repairs it: ask a peer what sequence each sender
// has reached, and pull the certificates we are missing.
//
// It grants the peer NO trust: every certificate fetched is applied through our own handle(), which
// re-verifies the sender signature, the quorum of authority signatures, the amount and the sequence.
// A malicious peer can therefore only ever hand us certificates we would have accepted anyway.
const SYNC_INTERVAL_MS = Number(process.env.SETU_SYNC_INTERVAL_MS ?? 30_000);
const SYNC_SENDERS_PER_ROUND = Number(process.env.SETU_SYNC_SENDERS ?? 25); // bounded work per round
const peers = committee.members.filter((m) => m.name !== name && m.url);

async function syncOnce(): Promise<void> {
  if (!peers.length) return;
  const peer = peers[Math.floor(Math.random() * peers.length)];
  let senders: { sender: string; nextSeq: number }[];
  try {
    const r = await fetch(`${peer.url}/digest`, { signal: AbortSignal.timeout(10_000) });
    senders = ((await r.json()) as { senders?: { sender: string; nextSeq: number }[] }).senders ?? [];
  } catch { return; }

  // Only the senders where the peer is AHEAD of us — those are the certificates we missed.
  const behind = senders
    .filter((x) => authority.accountInfo(x.sender).nextSeq < x.nextSeq)
    .slice(0, SYNC_SENDERS_PER_ROUND);
  let applied = 0;
  for (const { sender, nextSeq } of behind) {
    const from = authority.accountInfo(sender).nextSeq;
    const to = Math.min(nextSeq, from + 200);
    if (to <= from) continue;
    try {
      const r = await fetch(`${peer.url}/certs?sender=${encodeURIComponent(sender)}&from=${from}&to=${to}`, { signal: AbortSignal.timeout(10_000) });
      const { certificates } = (await r.json()) as { certificates?: unknown[] };
      for (const certificate of certificates ?? []) {
        const res = (await authority.handle({ type: 'certificate', certificate } as never)) as { ok: boolean };
        if (!res?.ok) break; // ordered replay: stop at the first one we cannot apply
        applied += 1;
      }
    } catch { /* try again next round */ }
  }
  if (applied) console.log(`[sync] applied ${applied} certificate(s) from ${peer.name}`);
}

if (process.env.SETU_SYNC !== 'off') {
  setInterval(() => { void syncOnce().catch(() => {}); }, SYNC_INTERVAL_MS).unref();
}

server.listen(port, host, () => {
  console.log(`${name} listening on ${host}:${port}${stateFile ? ` (state: ${stateFile})` : ' (in-memory)'}`);
});
