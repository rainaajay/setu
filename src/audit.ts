// An append-only audit log (brief §44). Records the event timeline of a purchase so a
// principal can inspect exactly what happened. Never store private keys or full sensitive
// request bodies here — only identifiers and outcomes.
export interface AuditEvent {
  at: number;
  type: string;
  actor: string;
  data?: Record<string, unknown>;
}

export class AuditLog {
  private events: AuditEvent[] = [];

  record(type: string, actor: string, data?: Record<string, unknown>): void {
    this.events.push({ at: Date.now(), type, actor, data });
  }

  timeline(): AuditEvent[] {
    return [...this.events];
  }

  types(): string[] {
    return this.events.map((e) => e.type);
  }
}
