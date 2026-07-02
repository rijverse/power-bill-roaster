import nodemailer from 'nodemailer';
import { EmailConfig } from '../config';
import { EmailContent } from '../types';

export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(private email: EmailConfig) {
    this.transporter = nodemailer.createTransport({
      host: email.host,
      port: email.port,
      secure: email.port === 465,
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
