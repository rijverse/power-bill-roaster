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

DESCO is about to cut your power. Recharge now or charge your phone at
McDonald's like it's 2005.

RECHARGE NOW → https://prepaid.desco.org.bd/

P.S. Your neighbors are judging you.`;
}

function generateHtml(balance: number, accountNo: string, meterNo: string): string {
  return renderEmail({
    accent: '#dc2626',
    bg: '#1a0a0a',
    badge: '💀⚡',
    title: 'Power Emergency',
    balance,
    balanceLabel: 'Critically low',
    pitch: '<strong>This is not a drill.</strong> DESCO will cut your power any moment now.',
    roast:
      "You'll be charging your phone at McDonald's like it's 2005, living off their WiFi and pretending to order fries.",
    accountNo,
    meterNo,
    footer: 'P.S. Your neighbors are judging you. 👀',
  });
}

interface EmailParts {
  accent: string;
  bg: string;
  badge: string;
  title: string;
  balance: number;
  balanceLabel: string;
  pitch: string;
  roast: string;
  accountNo: string;
  meterNo: string;
  footer: string;
}

// Single compact card. Inline styles only, table layout, solid colors with
// bgcolor fallbacks - the lowest common denominator that renders in Gmail,
// Outlook and Apple Mail alike.
export function renderEmail(p: EmailParts): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background-color:#0d0d0d; font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#0d0d0d" style="background-color:#0d0d0d;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="480" cellspacing="0" cellpadding="0" style="width:480px; max-width:100%; background-color:${p.bg}; border-radius:14px; overflow:hidden;">
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
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#000000" style="background-color:rgba(0,0,0,0.4); border-radius:8px;">
                <tr>
                  <td style="padding:12px 16px; color:#9ca3af; font-size:13px;">Account</td>
                  <td style="padding:12px 16px; color:#ffffff; font-size:14px; font-family:'Courier New',monospace; text-align:right;">${p.accountNo}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px; color:#9ca3af; font-size:13px; border-top:1px solid rgba(255,255,255,0.08);">Meter</td>
                  <td style="padding:12px 16px; color:#ffffff; font-size:14px; font-family:'Courier New',monospace; text-align:right; border-top:1px solid rgba(255,255,255,0.08);">${p.meterNo}</td>
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
            <td bgcolor="#000000" style="background-color:rgba(0,0,0,0.5); padding:16px; text-align:center; color:#6b7280; font-size:12px;">
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
