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
 * The provider couldn't be reached or errored out (network failure, timeout,
 * a non-JSON body). The meter numbers might be perfectly fine - retrying later
 * may succeed. Callers should say "try again" rather than "check your numbers".
 */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/**
 * The provider answered but had no valid balance for these identifiers - the
 * account/meter numbers most likely don't match a real meter. Callers should
 * ask the user to double-check the numbers.
 */
export class ProviderLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderLookupError';
  }
}
