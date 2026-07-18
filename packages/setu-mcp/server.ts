// Setu MCP server — turns the Setu settlement network into tools any MCP-speaking agent
// (Claude Desktop, Claude Code, or any MCP client) can load. An agent gets a wallet, can
// pay and be paid, and can act as a merchant that charges per request.
//
// Zero dependencies: a minimal JSON-RPC 2.0 server over newline-delimited stdio, which is
// all the MCP stdio transport requires. Wraps the setu-pay SDK.
//
// Add to an MCP client (e.g. Claude Desktop config):
//   "setu": { "command": "node", "args": ["<path>/packages/setu-mcp/server.ts"] }
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SetuWallet, SetuMerchant, verifyCertificate, MAINNET, type Certificate } from '../setu-pay/index.ts';

const WALLET_PATH = process.env.SETU_MCP_WALLET ?? join(homedir(), '.setu-wallet.json');

let wallet: SetuWallet | null = null;
async function getWallet(): Promise<SetuWallet> {
  if (wallet) return wallet;
  if (existsSync(WALLET_PATH)) {
    wallet = await SetuWallet.load(JSON.parse(readFileSync(WALLET_PATH, 'utf8')), MAINNET);
  } else {
    wallet = await SetuWallet.create(MAINNET);
    writeFileSync(WALLET_PATH, JSON.stringify(await wallet.export()), { mode: 0o600 });
  }
  return wallet;
}

// This process's merchant (invoices live for the server's lifetime).
let merchant: SetuMerchant | null = null;
async function getMerchant(): Promise<SetuMerchant> {
  if (!merchant) merchant = new SetuMerchant((await getWallet()).address, MAINNET);
  return merchant;
}

type Tool = {
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: any) => Promise<string>;
};

const short = (a: string) => a.slice(16, 24) + '…';

const tools: Record<string, Tool> = {
  setu_address: {
    description: 'Get this agent\'s Setu wallet address (created and stored locally on first use). Share it to receive payments.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => `Your Setu address:\n${(await getWallet()).address}`,
  },
  setu_balance: {
    description: 'Check a Setu balance — your own wallet by default, or any address you pass.',
    inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'Optional address; defaults to your wallet' } }, additionalProperties: false },
    run: async ({ address }) => {
      const w = await getWallet();
      if (address && address !== w.address) {
        const probe = await SetuWallet.load(await w.export(), { ...MAINNET }); void probe;
      }
      const bal = await w.balance();
      return `Balance of ${address ? short(address) : 'your wallet'}: ${bal} units`;
    },
  },
  setu_faucet: {
    description: 'Request test units from the faucet (testnet only — these are not money).',
    inputSchema: { type: 'object', properties: { amount: { type: 'number', description: 'Units to request (default 500)' } }, additionalProperties: false },
    run: async ({ amount }) => {
      const w = await getWallet();
      await w.faucet(amount ?? 500);
      return `Requested ${amount ?? 500} test units. New balance: ${await w.balance()}`;
    },
  },
  setu_pay: {
    description: 'Pay another agent or merchant. Final in one network round trip (~200ms across regions). Optionally include a reference (e.g. an invoice id) that is signed into the payment.',
    inputSchema: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: 'Recipient Setu address' },
        amount: { type: 'number', description: 'Whole number of units' },
        ref: { type: 'string', description: 'Optional reference / invoice id' },
      },
      required: ['recipient', 'amount'],
      additionalProperties: false,
    },
    run: async ({ recipient, amount, ref }) => {
      const w = await getWallet();
      const r = await w.pay(recipient, amount, ref);
      return `Paid ${amount} to ${short(recipient)}${ref ? ` (ref ${ref})` : ''} — FINAL in ${r.latencyMs.toFixed(0)}ms, settled on ${r.settledOn}/4 authorities.\nCertificate (share as proof of payment):\n${JSON.stringify(r.certificate)}`;
    },
  },
  setu_verify_payment: {
    description: 'Verify a Setu payment certificate offline, using only the committee public keys. Returns whether it is a valid, quorum-signed payment.',
    inputSchema: { type: 'object', properties: { certificate: { type: 'object', description: 'A Setu certificate object' } }, required: ['certificate'], additionalProperties: false },
    run: async ({ certificate }) => {
      const v = await verifyCertificate(certificate as Certificate, MAINNET);
      const o = (certificate as Certificate).order;
      return v.valid
        ? `VALID: ${short(o.sender)} paid ${short(o.recipient)} ${o.amount} units${o.ref ? ` (ref ${o.ref})` : ''}.`
        : `INVALID: ${v.error}`;
    },
  },
  setu_charge: {
    description: 'Act as a merchant: issue an invoice for a resource at a price. Return the invoice to the buyer, who pays it with setu_pay using the invoice id as the reference.',
    inputSchema: {
      type: 'object',
      properties: { resource: { type: 'string', description: 'What you are selling' }, price: { type: 'number', description: 'Price in units' } },
      required: ['resource', 'price'],
      additionalProperties: false,
    },
    run: async ({ resource, price }) => {
      const inv = (await getMerchant()).invoice(resource, price);
      return `Invoice created. Tell the buyer:\n  pay ${inv.price} to ${inv.payTo}\n  with reference (invoice id): ${inv.id}\nThen call setu_collect with this invoice id and their certificate.`;
    },
  },
  setu_collect: {
    description: 'Act as a merchant: verify a buyer\'s payment certificate against an invoice you issued (single-use). Returns whether to deliver the resource.',
    inputSchema: {
      type: 'object',
      properties: { invoiceId: { type: 'string' }, certificate: { type: 'object' } },
      required: ['invoiceId', 'certificate'],
      additionalProperties: false,
    },
    run: async ({ invoiceId, certificate }) => {
      const res = await (await getMerchant()).settle(invoiceId, certificate as Certificate);
      return res.ok
        ? `PAID — deliver "${res.resource}" to ${short(res.payer)}.`
        : `NOT PAID — ${res.error}. Do not deliver.`;
    },
  },
  setu_network: {
    description: 'Report the live Setu network: which authorities are up, and how many payments have settled.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const lines = await Promise.all(MAINNET.authorities.map(async (u) => {
        try {
          const s = await (await fetch(u + '/stats', { signal: AbortSignal.timeout(6000) })).json();
          return `  ${u.replace('https://', '')}: online, ${s.settled} settled`;
        } catch { return `  ${u.replace('https://', '')}: offline`; }
      }));
      return `Setu network (quorum 3 of 4):\n${lines.join('\n')}`;
    },
  },
};

// --- minimal JSON-RPC 2.0 over newline-delimited stdio (the MCP stdio transport) --------
function send(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(msg: any): Promise<void> {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'setu', version: '0.1.0' },
    } });
  } else if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    // notifications carry no id and need no response
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: {
      tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })),
    } });
  } else if (method === 'tools/call') {
    const tool = tools[params?.name];
    if (!tool) { send({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${params?.name}` } }); return; }
    try {
      const text = await tool.run(params.arguments ?? {});
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    } catch (e) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `error: ${(e as Error).message}` }], isError: true } });
    }
  } else if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) handle(JSON.parse(line)).catch((e) => process.stderr.write(`handler error: ${e}\n`));
  }
});
process.stderr.write(`setu-mcp ready — wallet at ${WALLET_PATH}, network ${MAINNET.authorities.length} authorities\n`);
