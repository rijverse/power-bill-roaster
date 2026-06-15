import { EmailContent } from '../types';

export function generateCriticalEmail(
  balance: number,
  accountNo: string,
  meterNo: string
): EmailContent {
  return {
    subject: "💀 EMERGENCY: You're About to Live in the Stone Age",
    text: generateText(balance, accountNo, meterNo),
    html: generateHtml(balance, accountNo, meterNo),
  };
}

function generateText(balance: number, accountNo: string, meterNo: string): string {
  return `💀 POWER EMERGENCY - THIS IS NOT A DRILL

Current Balance: ৳${balance.toFixed(2)} (CRITICALLY LOW)
Account: ${accountNo}
Meter: ${meterNo}

That balance has two digits. TWO. Your fridge is writing its will. Your WiFi
router is updating its resume. DESCO has its finger on the switch and is
mouthing "do it" at you.

When the lights die you'll be the grown adult charging a phone at McDonald's,
nursing one cold fry, calling it "working remotely." Your ancestors survived
famine and war so you could forget to top up a meter.

RECHARGE NOW → https://prepaid.desco.org.bd/

P.S. The dark is free. The shame is too. Your neighbors already know.`;
}

function generateHtml(balance: number, accountNo: string, meterNo: string): string {
  return renderEmail({
    accent: '#dc2626',
    bg: '#1a0a0a',
    badge: '💀⚡',
    title: 'Power Emergency',
    preheader: `৳${balance.toFixed(2)} left. DESCO is about to pull the plug.`,
    balance,
    balanceLabel: 'Critically low',
    pitch:
      '<strong>This is not a drill.</strong> Two digits. DESCO has its finger on the switch and is mouthing "do it" at you.',
    roast:
      'Lights go out and you become the grown adult charging a phone at McDonald\'s, nursing one cold fry, calling it "working remotely."<br><br>Your ancestors survived famine and war so you could forget to top up a meter. Make them proud. Or don\'t - the dark is free.',
    accountNo,
    meterNo,
    footer: 'P.S. The shame is free too. Your neighbors already know. 👀',
  });
}

interface EmailParts {
  accent: string;
  bg: string;
  badge: string;
  title: string;
  preheader: string;
  balance: number;
  balanceLabel: string;
  pitch: string;
  roast: string;
  accountNo: string;
  meterNo: string;
  footer: string;
}

// Single compact card. Inline styles only, table layout, solid hex colors (no
// rgba - Outlook's Word engine drops it) - the lowest common denominator that
// renders in Gmail, Outlook and Apple Mail alike.
export function renderEmail(p: EmailParts): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background-color:#0d0d0d; font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; opacity:0; color:transparent; height:0; width:0;">${p.preheader}&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#0d0d0d" style="background-color:#0d0d0d;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%; max-width:480px; background-color:${p.bg}; border-radius:14px; overflow:hidden;">
          <tr>
            <td bgcolor="${p.accent}" style="background-color:${p.accent}; padding:20px; text-align:center; color:#ffffff; font-size:20px; font-weight:800; text-transform:uppercase; letter-spacing:1px;">
              ${p.badge} ${p.title}
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px; text-align:center;">
              <p style="margin:0 0 4px; color:#9ca3af; font-size:12px; text-transform:uppercase; letter-spacing:2px;">Current Balance</p>
              <p style="margin:0; color:#ffffff; font-size:48px; font-weight:900; line-height:1;">৳${p.balance.toFixed(2)}</p>
              <p style="margin:8px 0 0; color:${p.accent}; font-size:14px; font-weight:700; text-transform:uppercase;">⚠️ ${p.balanceLabel}</p>
              <p style="margin:24px 0 12px; color:#f3f4f6; font-size:16px; line-height:1.5;">${p.pitch}</p>
              <p style="margin:0; color:#9ca3af; font-size:14px; line-height:1.6; font-style:italic;">${p.roast}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#12121c" style="background-color:#12121c; border-radius:8px;">
                <tr>
                  <td style="padding:12px 16px; color:#9ca3af; font-size:13px;">Account</td>
                  <td style="padding:12px 16px; color:#ffffff; font-size:14px; font-family:'Courier New',monospace; text-align:right;">${p.accountNo}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px; color:#9ca3af; font-size:13px; border-top:1px solid #2a2a38;">Meter</td>
                  <td style="padding:12px 16px; color:#ffffff; font-size:14px; font-family:'Courier New',monospace; text-align:right; border-top:1px solid #2a2a38;">${p.meterNo}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px; text-align:center;">
              <a href="https://prepaid.desco.org.bd/" style="display:inline-block; background-color:${p.accent}; color:#ffffff; text-decoration:none; padding:14px 36px; border-radius:999px; font-size:16px; font-weight:700; text-transform:uppercase; letter-spacing:1px;">⚡ Recharge Now</a>
            </td>
          </tr>
          <tr>
            <td bgcolor="#0a0a12" style="background-color:#0a0a12; padding:16px; text-align:center; color:#6b7280; font-size:12px;">
              ${p.footer}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
