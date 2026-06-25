import { BalanceData } from '../types';

export interface MeterIdentity {
  accountNo: string;
  meterNo: string;
}

/**
 * a prepaid electricity provider adapter. desco today dpdc, nesco, etc.
 * in phase 3   each new distribution company implements this interface.
 */
export interface Provider {
  readonly name: string;
  getBalance(meter: MeterIdentity): Promise<BalanceData>;
}

/**
 * Couldn't reach the provider, or it errored out (network, timeout, non-JSON
 * body). The meter numbers might be perfectly fine, so this is a "try again
 * later" — not a "wrong number".
 */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/**
 * The provider answered but had no balance for these numbers — they most likely
 * don't match a real meter, so it's worth double-checking them.
 */
export class ProviderLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderLookupError';
  }
}
