import nodemailer from 'nodemailer';
import { ServerConfig } from '../config';

/** Sends to an arbitrary recipient. The SaaS counterpart of the single-user
 *  EmailService (services/email.ts): magic-link sign-in and email alerts both
 *  go through here. Null when SMTP isn't configured (email features off). */
export interface Mailer {
  readonly from: string;
  send(to: string, subject: string, text: string, html: string): Promise<void>;
}

export function createMailer(config: ServerConfig): Mailer | null {
  const mail = config.mail;
  if (!mail) {
    return null;
  }
  const transporter = nodemailer.createTransport({
    host: mail.host,
    port: mail.port,
    secure: mail.port === 465,
    auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined,
    // don't let a stalled SMTP connection hang a request or a poll cycle
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  return {
    from: mail.from,
    async send(to, subject, text, html) {
      await transporter.sendMail({ from: mail.from, to, subject, text, html });
    },
  };
}
