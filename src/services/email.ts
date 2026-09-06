import nodemailer from 'nodemailer';
import { EmailConfig } from '../config';
import { EmailContent } from '../types';

export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(private email: EmailConfig) {
    const secure = email.port === 465;
    const isLocalhost =
      email.host === 'localhost' || email.host === '127.0.0.1' || email.host === '::1';
    this.transporter = nodemailer.createTransport({
      host: email.host,
      port: email.port,
      secure,
      // Force STARTTLS on 587/25 for remote hosts: without it a MITM can strip
      // the STARTTLS ad and carry alert emails in cleartext. No-op on 465
      // (implicit TLS). Localhost (Mailpit, a trusted local relay) is exempted.
      requireTLS: !secure && !isLocalhost,
      auth: {
        user: email.user,
        pass: email.pass,
      },
      // don't let a stalled SMTP connection hang the (CLI/GitHub Actions) run
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
  }

  async send(content: EmailContent): Promise<void> {
    await this.transporter.sendMail({
      from: this.email.from,
      to: this.email.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  }
}
