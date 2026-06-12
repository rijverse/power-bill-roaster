import fetch from 'node-fetch';
import { SmsGateway } from './types';

export interface BulkSmsBdConfig {
  apiKey: string;
  senderId: string;
  /** overridable for tests/mocks */
  baseUrl: string;
}

// http://bulksmsbd.net/api/smsapi - 202 means accepted
const SUCCESS_CODE = 202;

export class BulkSmsBdGateway implements SmsGateway {
  readonly name = 'bulksmsbd';

  constructor(private config: BulkSmsBdConfig) {}

  async send(phone: string, text: string): Promise<void> {
    const url =
      `${this.config.baseUrl}/smsapi` +
      `?api_key=${encodeURIComponent(this.config.apiKey)}` +
      `&type=text&number=${encodeURIComponent(phone)}` +
      `&senderid=${encodeURIComponent(this.config.senderId)}` +
      `&message=${encodeURIComponent(text)}`;

    const response = await fetch(url);
    const body: unknown = await response.json();
    const code =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>).response_code
        : undefined;
    if (code !== SUCCESS_CODE) {
      throw new Error(`BulkSMSBD rejected the message: ${JSON.stringify(body)}`);
    }
  }
}
