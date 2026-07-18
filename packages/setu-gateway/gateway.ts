// Setu x402 gateway — an HTTP endpoint that sells a resource, payable by ANY agent over
// the web with no Setu-specific knowledge beyond "pay this address on Setu". It follows the
// x402 request/response shape (HTTP 402 + `accepts[]`, then an `X-PAYMENT` header on retry)
// with a Setu settlement scheme, and publishes an A2A-style agent card so agents can
// discover it. Zero dependencies; wraps the setu-pay SDK.
//
// Run: node packages/setu-gateway/gateway.ts   (env PORT, HOST)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SetuWallet, SetuMerchant, MAINNET, type Certificate } from '../setu-pay/index.ts';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '127.0.0.1';
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://${HOST}:${PORT}`;
const RESOURCE = '/premium-quote';
const PRICE = 1;

const merchantWallet = await SetuWallet.create(MAINNET); // the gateway's own receiving wallet
const merchant = new SetuMerchant(merchantWallet.address, MAINNET);
const PAY_TO = merchantWallet.address;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, x-payment',
  'access-control-expose-headers': 'x-payment-response',
};
const b64 = (s: string) => Buffer.from(s).toString('base64');
const unb64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');

function json(res: ServerResponse, code: number, body: unknown, extra: Record<string, string> = {}) {
  res.writeHead(code, { 'content-type': 'application/json', ...CORS, ...extra });
  res.end(JSON.stringify(body, null, 2));
}

// The A2A-style agent card: a machine-readable descriptor so agents can DISCOVER what this
// service does and how to pay for it. Served at /.well-known/agent-card.json.
function agentCard() {
  return {
    // Core A2A AgentCard fields (github.com/a2aproject/A2A).
    protocolVersion: '0.3.0',
    name: 'Setu Quote Service',
    description: 'A demonstration paid API on the Setu settlement network. Returns a market quote; each call costs 1 test unit, payable over Setu with no account or API key.',
    url: PUBLIC_URL,
    preferredTransport: 'HTTP+JSON',
    version: '0.1.0',
    provider: { organization: 'Setu', url: 'https://setu-mocha.vercel.app' },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['application/json'],
    skills: [
      {
        id: 'premium-quote',
        name: 'Premium quote',
        description: 'Returns a market quote. Payment-gated at 1 unit via Setu (x402).',
        tags: ['finance', 'quote', 'paid', 'x402'],
        examples: ['Get a market quote'],
        inputModes: ['text/plain'],
        outputModes: ['application/json'],
      },
    ],
    // Payment extension (not core A2A): how to pay for the skills, using x402 over Setu.
    payments: {
      protocol: 'x402',
      scheme: 'setu',
      network: 'setu-testnet',
      endpoint: PUBLIC_URL + RESOURCE,
      payTo: PAY_TO,
      price: { amount: PRICE, asset: 'SETU-TESTNET-UNIT' },
      settlement: 'https://setu-mocha.vercel.app',
      committee: { authorities: MAINNET.authorities, quorum: MAINNET.quorum },
      note: 'Test units, not money.',
    },
  };
}

// The x402 "payment required" challenge — tells the caller exactly how to pay.
function paymentRequired(res: ServerResponse) {
  const invoice = merchant.invoice(RESOURCE.slice(1), PRICE);
  json(res, 402, {
    x402Version: 1,
    error: 'payment required',
    accepts: [
      {
        scheme: 'setu',
        network: 'setu-testnet',
        resource: RESOURCE,
        description: 'A sample market quote',
        payTo: PAY_TO,
        maxAmountRequired: String(PRICE),
        asset: 'SETU-TESTNET-UNIT',
        extra: {
          invoiceId: invoice.id,
          committee: { authorities: MAINNET.authorities, quorum: MAINNET.quorum },
          how: `Pay ${PRICE} to payTo on Setu with ref=invoiceId, then retry this request with header X-PAYMENT = base64({"scheme":"setu","invoiceId":"…","certificate":{…}}).`,
        },
      },
    ],
  });
}

async function deliverIfPaid(req: IncomingMessage, res: ServerResponse) {
  const header = req.headers['x-payment'];
  if (typeof header !== 'string') return paymentRequired(res);
  let payment: { scheme: string; invoiceId: string; certificate: Certificate };
  try {
    payment = JSON.parse(unb64(header));
  } catch {
    return json(res, 400, { error: 'malformed X-PAYMENT header' });
  }
  if (payment.scheme !== 'setu') return json(res, 402, { error: 'unsupported payment scheme' });
  const settled = await merchant.settle(payment.invoiceId, payment.certificate);
  if (!settled.ok) return json(res, 402, { error: `payment not accepted: ${settled.error}` });
  // Paid — deliver the resource.
  json(res, 200,
    { resource: 'premium-quote', symbol: 'SETU', mid: (100 + Math.random() * 20).toFixed(2), servedTo: settled.payer.slice(16, 24) + '…', at: 'now' },
    { 'x-payment-response': b64(JSON.stringify({ settled: true, payer: settled.payer })) },
  );
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', PUBLIC_URL);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS).end(); return; }
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/.well-known/agent-card.json') return json(res, 200, agentCard());
    if (req.method === 'GET' && url.pathname === RESOURCE) return deliverIfPaid(req, res);
    json(res, 404, { error: 'not found', try: ['/.well-known/agent-card.json', RESOURCE] });
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
  }
});

server.listen(PORT, HOST, () => {
  process.stderr.write(`setu-gateway on ${HOST}:${PORT} — selling ${RESOURCE} for ${PRICE} unit, payTo ${PAY_TO.slice(16, 24)}…\n`);
});
