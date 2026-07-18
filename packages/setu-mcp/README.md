# setu-mcp

An [MCP](https://modelcontextprotocol.io) server for the Setu settlement network. Load it
into any MCP client and your agent can hold a wallet, pay other agents, and charge for its
own services — feeless, final in one round trip, no blockchain. Zero dependencies.

## Add to an MCP client

Claude Desktop (`claude_desktop_config.json`), Claude Code, or any MCP client:

```json
{
  "mcpServers": {
    "setu": { "command": "node", "args": ["/absolute/path/to/setu/packages/setu-mcp/server.ts"] }
  }
}
```

Requires Node ≥ 20 (runs the TypeScript natively). The wallet is created on first use and
stored at `~/.setu-wallet.json` (override with `SETU_MCP_WALLET`).

## Tools

| Tool | What the agent can do |
|---|---|
| `setu_address` | Get its own wallet address (to receive payments) |
| `setu_balance` | Check a balance |
| `setu_faucet` | Draw test units (testnet) |
| `setu_pay` | Pay an agent/merchant; returns a settlement certificate |
| `setu_verify_payment` | Verify a certificate offline with the committee keys |
| `setu_charge` | As a merchant: issue an invoice |
| `setu_collect` | As a merchant: verify a buyer's payment against an invoice |
| `setu_network` | See which authorities are up and how much has settled |

## Try it

```
node smoke-test.ts   # drives the server over stdio against the live network
```

Network: <https://setu-mocha.vercel.app>. Units are test units, not money. MIT.
