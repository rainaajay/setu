// v0.2 transport: real sockets via Node's built-in HTTP (zero deps). Implements the
// same Network interface as InProcessNetwork, so Wallet/protocol code is untouched.
import type { Handler, Network } from './network.ts';

export class HttpNetwork implements Network {
  private urls: Map<string, string>;

  constructor(peers: Record<string, string>) {
    this.urls = new Map(Object.entries(peers)); // name → http://host:port
  }

  register(_id: string, _handler: Handler): void {
    throw new Error('HttpNetwork peers are separate processes — see authority-server.ts');
  }

  setOnline(_id: string, _online: boolean): void {
    // liveness of a real process is controlled by starting/killing it, not a flag
  }

  async send(to: string, msg: unknown): Promise<unknown> {
    const url = this.urls.get(to);
    if (!url) throw new Error(`unknown peer ${to}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(2000),
    });
    return res.json();
  }
}
