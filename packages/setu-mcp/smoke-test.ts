// Drives the Setu MCP server over stdio exactly as an MCP client would, and exercises the
// real tools against the live network. Run: node packages/setu-mcp/smoke-test.ts
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = dirname(fileURLToPath(import.meta.url));
// Use a throwaway wallet file so the smoke test never touches a real one.
const walletFile = join(tmpdir(), `setu-mcp-smoke-${process.pid}.json`);
const srv = spawn(process.execPath, [join(dir, 'server.ts')], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, SETU_MCP_WALLET: walletFile },
});

let buf = '';
const waiters = new Map<number, (msg: any) => void>();
srv.stdout.setEncoding('utf8');
srv.stdout.on('data', (chunk) => {
  buf += chunk;
  let nl: number;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && waiters.has(msg.id)) { waiters.get(msg.id)!(msg); waiters.delete(msg.id); }
  }
});

let nextId = 1;
function rpc(method: string, params?: unknown): Promise<any> {
  const id = nextId++;
  return new Promise((resolve) => {
    waiters.set(id, resolve);
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function notify(method: string) { srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'); }
const callText = async (name: string, args: Record<string, unknown> = {}) =>
  (await rpc('tools/call', { name, arguments: args })).result.content[0].text;

try {
  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
  console.log(`initialize → ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);
  notify('notifications/initialized');

  const list = await rpc('tools/list');
  console.log(`tools/list → ${list.result.tools.map((t: any) => t.name).join(', ')}\n`);

  console.log(await callText('setu_network'));
  console.log('\n' + await callText('setu_address'));
  console.log(await callText('setu_faucet', { amount: 20 }));

  // Pay a throwaway recipient and verify the certificate the tool returns.
  const recipient = (await import('../setu-pay/index.ts')).SetuWallet;
  const payee = await recipient.create();
  const payText = await callText('setu_pay', { recipient: payee.address, amount: 5, ref: 'smoke-1' });
  console.log('\n' + payText.split('\nCertificate')[0]);
  const cert = JSON.parse(payText.split('Certificate (share as proof of payment):\n')[1]);
  console.log(await callText('setu_verify_payment', { certificate: cert }));
  console.log(await callText('setu_balance'));

  console.log('\nMCP server works end-to-end against the live network.');
} finally {
  srv.kill();
}
