// Network abstraction. v0 runs in-process with simulated latency; v0.2 swaps this for
// libp2p/WebSocket transport without touching protocol code (SPEC.md roadmap).
export type Handler = (msg: unknown) => Promise<unknown>;

export interface Network {
  register(id: string, handler: Handler): void;
  setOnline(id: string, online: boolean): void;
  send(to: string, msg: unknown): Promise<unknown>;
}

export class InProcessNetwork implements Network {
  private handlers = new Map<string, Handler>();
  private online = new Map<string, boolean>();

  private minLatencyMs: number;
  private maxLatencyMs: number;

  constructor(minLatencyMs = 3, maxLatencyMs = 12) {
    this.minLatencyMs = minLatencyMs;
    this.maxLatencyMs = maxLatencyMs;
  }

  register(id: string, handler: Handler): void {
    this.handlers.set(id, handler);
    this.online.set(id, true);
  }

  setOnline(id: string, online: boolean): void {
    this.online.set(id, online);
  }

  async send(to: string, msg: unknown): Promise<unknown> {
    const handler = this.handlers.get(to);
    if (!handler || !this.online.get(to)) {
      await this.hop(); // a dead peer still costs a timeout in real life
      throw new Error(`${to} unreachable`);
    }
    await this.hop();
    const response = await handler(structuredClone(msg)); // no shared-memory cheating
    await this.hop();
    return structuredClone(response);
  }

  private hop(): Promise<void> {
    const ms = this.minLatencyMs + Math.random() * (this.maxLatencyMs - this.minLatencyMs);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
