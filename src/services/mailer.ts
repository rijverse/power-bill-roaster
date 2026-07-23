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
  const secure = mail.port === 465;
  const isLocalhost = mail.host === 'localhost' || mail.host === '127.0.0.1' || mail.host === '::1';
  const transporter = nodemailer.createTransport({
    host: mail.host,
    port: mail.port,
    secure,
    // Force STARTTLS on 587/25 for remote hosts: a network MITM can otherwise
    // strip the STARTTLS ad and carry magic links / alert bodies in cleartext.
    // No-op on 465 (implicit TLS). Localhost (Mailpit, a trusted local relay)
    // is exempted because it carries no traffic over a network and often has no
    // STARTTLS support at all.
    requireTLS: !secure && !isLocalhost,
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
