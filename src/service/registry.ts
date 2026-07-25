// A service registry with machine-readable discovery (brief §11/§12). Agents query by
// capability and constraints and get structured listings back — not a webpage scrape.
import type { SetuService } from './service.ts';

export type ServiceStatus = 'draft' | 'active' | 'degraded' | 'suspended' | 'retired';

export interface Listing {
  id: string;
  name: string;
  capability: string;
  price: number;
  unit: string;
  address: string;
  region: string;
  status: ServiceStatus;
  verified: boolean; // registered (verified) vs a direct unverified endpoint
}

export interface DiscoveryQuery {
  capability: string;
  maxPrice?: number;
  region?: string;
}

export class ServiceRegistry {
  private entries = new Map<string, { svc: SetuService; region: string; status: ServiceStatus; verified: boolean }>();

  register(svc: SetuService, region = 'global', status: ServiceStatus = 'active', verified = true): void {
    this.entries.set(svc.id, { svc, region, status, verified });
  }

  get(id: string): SetuService | undefined {
    return this.entries.get(id)?.svc;
  }

  setStatus(id: string, status: ServiceStatus): void {
    const e = this.entries.get(id);
    if (e) e.status = status;
  }

  discover(q: DiscoveryQuery): Listing[] {
    return [...this.entries.values()]
      .filter(({ svc, status, region }) =>
        status === 'active' &&
        svc.capability === q.capability &&
        (q.maxPrice === undefined || svc.price <= q.maxPrice) &&
        (q.region === undefined || region === q.region || region === 'global'))
      .map(({ svc, region, status, verified }) => ({
        id: svc.id, name: svc.name, capability: svc.capability, price: svc.price,
        unit: svc.unit, address: svc.address, region, status, verified,
      }))
      .sort((a, b) => a.price - b.price);
  }
}
