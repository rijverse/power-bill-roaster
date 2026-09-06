/**
 * A WhatsApp sender adapter. A console stub today; the Meta Cloud API (or Twilio)
 * sender lands here later - each provider implements this interface, mirroring
 * the SMS gateway and electricity Provider patterns.
 */
export interface WhatsAppSender {
  readonly name: string;
  /** phone is the WhatsApp id / E.164 digits the inbound webhook reported, text is plain */
  send(phone: string, text: string): Promise<void>;
}
