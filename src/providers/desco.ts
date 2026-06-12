import { DescoApiClient } from '../services/desco-api';
import { BalanceData } from '../types';
import { MeterIdentity, Provider } from './types';

export class DescoProvider implements Provider {
  readonly name = 'desco';
  private client = new DescoApiClient();

  getBalance(meter: MeterIdentity): Promise<BalanceData> {
    return this.client.getBalance(meter.accountNo, meter.meterNo);
  }
}
