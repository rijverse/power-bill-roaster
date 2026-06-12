/**
 * An SMS gateway adapter. BulkSMSBD today; SSL Wireless or others later -
 * each provider implements this interface, mirroring the electricity
 * Provider pattern.
 */
export interface SmsGateway {
  readonly name: string;
  /** phone is normalized 880XXXXXXXXXX format, text is plain ASCII */
  send(phone: string, text: string): Promise<void>;
}
