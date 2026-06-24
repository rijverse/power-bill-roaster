import { EmailContent } from '../types';
import { renderEmail } from './critical';

export function generateWarningEmail(
  balance: number,
  accountNo: string,
  meterNo: string,
  rechargeUrl: string = 'https://prepaid.desco.org.bd/'
): EmailContent {
  return {
    subject: '🚨 Yo, Your Electricity About to Ghost You!',
    text: generateText(balance, accountNo, meterNo, rechargeUrl),
    html: generateHtml(balance, accountNo, meterNo, rechargeUrl),
  };
}

function generateText(
  balance: number,
  accountNo: string,
  meterNo: string,
  rechargeUrl: string
): string {
  return `🚨 BALANCE RUNNING LOW - Bruh, wake up!

Current Balance: ৳${balance.toFixed(2)}
Account: ${accountNo}
Meter: ${meterNo}

That number is wheezing. It's got "left on read" energy, "checking account
three days before payday" energy. Not zero yet, but it can see zero from here
and zero is waving back.

You really gonna gamble on it? Ride the meter to empty like a main character,
then act shocked when the AC dies at 3am and you're sweating through the
mattress doing the math you should've done today.

RECHARGE NOW → ${rechargeUrl}

Top up now while you still have the dignity. Seriously.`;
}

function generateHtml(
  balance: number,
  accountNo: string,
  meterNo: string,
  rechargeUrl: string
): string {
  return renderEmail({
    accent: '#f59e0b',
    bg: '#1a1625',
    badge: '🚨⚡',
    title: 'Balance Running Low',
    preheader: `৳${balance.toFixed(2)} left and dropping. Top up before zero waves back.`,
    balance,
    balanceLabel: 'Getting low',
    pitch:
      '<strong>Bruh, wake up.</strong> This balance is wheezing - "checking account three days before payday" energy.',
    roast:
      "Not zero yet, but it can see zero from here, and zero is waving back.<br><br>Ride the meter to empty like a main character and act shocked when the AC dies at 3am and you're sweating through the mattress doing the math you should've done today.",
    accountNo,
    meterNo,
    footer: 'Top up while you still have the dignity. 💪',
    rechargeUrl,
  });
}
