// The Setu Treasury — the named issuer that gives Credits their provenance. Instead of
// balances appearing from nowhere, a fixed genesis supply lives in one Treasury account,
// and every Credit in circulation is a real settled transfer out of it. See CREDITS.md.
import { generateKeyPair, type KeyPair } from './crypto.ts';
import { Wallet } from './client.ts';
import type { Network } from './network.ts';

export class Issuer {
  readonly treasury: Wallet;
  readonly supply: number;
  private issuedTotal = 0;

  constructor(network: Network, authorityIds: string[], quorum: number, supply: number, keys?: KeyPair) {
    this.treasury = new Wallet('treasury', network, authorityIds, quorum, keys ?? generateKeyPair());
    this.supply = supply;
  }

  get address(): string {
    return this.treasury.address;
  }
  get issued(): number {
    return this.issuedTotal;
  }

  // Issue Credits to a holder — a real Setu payment from the Treasury, so the Credit's
  // origin is provable and the supply is conserved.
  async issue(to: string, amount: number): Promise<void> {
    await this.treasury.transfer(to, amount);
    this.issuedTotal += amount;
  }
}
