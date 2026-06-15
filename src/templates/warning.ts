import { EmailContent } from '../types';
import { renderEmail } from './critical';

export function generateWarningEmail(
  balance: number,
  accountNo: string,
  meterNo: string
): EmailContent {
  return {
    subject: '🚨 Yo, Your Electricity About to Ghost You!',
    text: generateText(balance, accountNo, meterNo),
    html: generateHtml(balance, accountNo, meterNo),
  };
}

function generateText(balance: number, accountNo: string, meterNo: string): string {
  return `🚨 BALANCE RUNNING LOW - Bruh, wake up!

Current Balance: ৳${balance.toFixed(2)}
Account: ${accountNo}
Meter: ${meterNo}

Your DESCO balance is looking sad. Recharge now before you're sitting in the
dark contemplating poor life choices.

RECHARGE NOW → https://prepaid.desco.org.bd/

Get your act together. Seriously.`;
}

function generateHtml(balance: number, accountNo: string, meterNo: string): string {
  return renderEmail({
    accent: '#f59e0b',
    bg: '#1a1625',
    badge: '🚨⚡',
    title: 'Balance Running Low',
    balance,
    balanceLabel: 'Getting low',
    pitch: '<strong>Bruh, wake up!</strong> Your DESCO balance is looking kinda sad right now.',
    roast:
      "You really gonna let your lights go dark like your future? Don't be that person in the dark contemplating poor life choices.",
    accountNo,
    meterNo,
    footer: 'Get your act together. Seriously. 💪',
  });
}
