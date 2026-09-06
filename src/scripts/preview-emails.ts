import nodemailer from 'nodemailer';
import { AlertAction } from '../core/alert-machine';
import { TONES } from '../core/tone';
import { emailAlert } from '../notifications/email-templates';
import { MeterContext } from '../notifications/alert-copy';

// Sends every alert email (4 actions x 2 tones) to a local SMTP sink (Mailpit by
// default) so you can eyeball the rendered HTML without touching DESCO or a real
// mailbox.
//   docker compose up -d mailpit
//   bun run mail:preview
//   open http://localhost:8025

// A balance that actually triggers each action, so the card reads true.
const BALANCE: Record<Exclude<AlertAction, 'none'>, number> = {
  'low-alert': 128.75,
  'critical-alert': 42.5,
  reminder: 96.2,
  recovery: 480.0,
};

async function main(): Promise<void> {
  const host = process.env.SMTP_HOST || '127.0.0.1';
  const port = Number(process.env.SMTP_PORT || 1025);
  const from = process.env.EMAIL_FROM || 'power-roast@localhost';
  const to = process.env.EMAIL_TO || 'you@localhost';

  const transporter = nodemailer.createTransport({ host, port, secure: false });

  const base: Omit<MeterContext, 'balance'> = {
    nickname: 'Flat 3B',
    accountNo: '13151091',
    meterNo: '661120227647',
    lowThreshold: 150,
    criticalThreshold: 100,
    prediction: { burnPerDay: 35, daysLeft: 2.4 },
  };

  for (const action of Object.keys(BALANCE) as Exclude<AlertAction, 'none'>[]) {
    for (const tone of TONES) {
      const email = emailAlert(action, { ...base, balance: BALANCE[action] }, tone);
      if (!email) {
        continue;
      }
      await transporter.sendMail({ from, to, ...email });
      console.log(`sent: [${tone}] ${email.subject}`);
    }
  }
  console.log(`\nOpen the inbox: http://localhost:8025`);
}

void main().catch(error => {
  console.error('preview failed:', error);
  process.exit(1);
});
