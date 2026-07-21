// The shared HTML email card. One compact card, inline styles only, table
// layout, solid hex colors (no rgba - Outlook's Word engine drops it) - the
// lowest common denominator that renders in Gmail, Outlook and Apple Mail alike.
// The wording comes from alert-copy.ts; this only lays it out. Colours mirror
// the "Roast Brutal" web theme (src/web/theme.ts), hard-coded to hex because mail
// clients don't support CSS custom properties or oklch(). Dark ink sits on the
// accent header/button (light amber/green would fail contrast under white).

export interface EmailParts {
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
  rechargeUrl: string;
}

export function renderEmail(p: EmailParts): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background-color:#14110c; font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; opacity:0; color:transparent; height:0; width:0;">${p.preheader}&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#14110c" style="background-color:#14110c;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%; max-width:480px; background-color:${p.bg}; border-radius:4px; overflow:hidden; border:1px solid #3a3126;">
          <tr>
            <td bgcolor="${p.accent}" style="background-color:${p.accent}; padding:20px; text-align:center; color:#1a1408; font-size:20px; font-weight:800; text-transform:uppercase; letter-spacing:1px;">
              ${p.badge} ${p.title}
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px; text-align:center;">
              <p style="margin:0 0 4px; color:#a79d8c; font-size:12px; text-transform:uppercase; letter-spacing:2px;">Current Balance</p>
              <p style="margin:0; color:#f5f1ea; font-size:48px; font-weight:900; line-height:1;">৳${p.balance.toFixed(2)}</p>
              <p style="margin:8px 0 0; color:${p.accent}; font-size:14px; font-weight:700; text-transform:uppercase;">⚠️ ${p.balanceLabel}</p>
              <p style="margin:24px 0 12px; color:#f5f1ea; font-size:16px; line-height:1.5;">${p.pitch}</p>
              <p style="margin:0; color:#a79d8c; font-size:14px; line-height:1.6; font-style:italic;">${p.roast}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#29241c" style="background-color:#29241c; border-radius:3px;">
                <tr>
                  <td style="padding:12px 16px; color:#a79d8c; font-size:13px;">Account</td>
                  <td style="padding:12px 16px; color:#f5f1ea; font-size:14px; font-family:'Courier New',monospace; text-align:right;">${p.accountNo}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px; color:#a79d8c; font-size:13px; border-top:1px solid #3a3126;">Meter</td>
                  <td style="padding:12px 16px; color:#f5f1ea; font-size:14px; font-family:'Courier New',monospace; text-align:right; border-top:1px solid #3a3126;">${p.meterNo}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px; text-align:center;">
              <a href="${p.rechargeUrl}" style="display:inline-block; background-color:${p.accent}; color:#1a1408; text-decoration:none; padding:14px 36px; border-radius:3px; font-size:16px; font-weight:700; text-transform:uppercase; letter-spacing:1px;">⚡ Recharge Now</a>
            </td>
          </tr>
          <tr>
            <td bgcolor="#0f0d08" style="background-color:#0f0d08; padding:16px; text-align:center; color:#837a68; font-size:12px;">
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
