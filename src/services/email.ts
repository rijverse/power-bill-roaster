import nodemailer from 'nodemailer';
import { Config } from '../config';
import { EmailContent } from '../types';

export class EmailService {
  private transporter: nodemailer.Transporter;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
      // don't let a stalled SMTP connection hang the (CLI/GitHub Actions) run
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
  }

  async send(content: EmailContent): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.email.from,
      to: this.config.email.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  }
}
