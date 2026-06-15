import nodemailer from 'nodemailer';
import { generateCriticalEmail, generateWarningEmail } from '../templates';

// Sends both roast emails to a local SMTP sink (Mailpit by default) so you can
// eyeball the rendered HTML without touching DESCO or a real mailbox.
//   docker compose up -d mailpit
//   bun run mail:preview
//   open http://localhost:8025
async function main(): Promise<void> {
  const host = process.env.SMTP_HOST || '127.0.0.1';
  const port = Number(process.env.SMTP_PORT || 1025);
  const from = process.env.EMAIL_FROM || 'power-roast@localhost';
  const to = process.env.EMAIL_TO || 'you@localhost';

  const transporter = nodemailer.createTransport({ host, port, secure: false });

  const balances = { critical: 42.5, warning: 128.75 };
  const accountNo = '13151091';
  const meterNo = '661120227647';

  const emails = [
    generateWarningEmail(balances.warning, accountNo, meterNo),
    generateCriticalEmail(balances.critical, accountNo, meterNo),
  ];

  for (const email of emails) {
    await transporter.sendMail({ from, to, ...email });
    console.log(`sent: ${email.subject}`);
  }
  console.log(`\nOpen the inbox: http://localhost:8025`);
}

void main().catch(error => {
  console.error('preview failed:', error);
  process.exit(1);
});
