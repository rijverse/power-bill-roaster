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
