import { EmailContent } from '../types';

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
  return `🚨 BALANCE RUNNING LOW 🚨

Bruh, wake up!

Current Balance: ৳${balance.toFixed(2)}

Your DESCO balance is looking kinda sad right now. That's BROKE energy right there.

Account: ${accountNo}
Meter: ${meterNo}

You really gonna let your lights go dark like your future? Recharge NOW before you're sitting in the dark like a caveman contemplating your poor life choices.

RECHARGE NOW → https://prepaid.desco.org.bd/

Get your act together. Seriously.`;
}

function generateHtml(balance: number, accountNo: string, meterNo: string): string {
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0 padding: 0 font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif background-color: #0a0a0a">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0a0a0a">
        <tr>
            <td align="center" style="padding: 40px 20px">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #0c0a15 0%, #1a1625 100%) border-radius: 16px overflow: hidden box-shadow: 0 25px 50px rgba(251, 191, 36, 0.2)">
                    
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(90deg, #f59e0b 0%, #d97706 100%) padding: 30px text-align: center">
                            <div style="font-size: 64px margin-bottom: 10px">🚨⚡🚨</div>
                            <h1 style="margin: 0 color: #0c0a0a font-size: 26px font-weight: 800 text-transform: uppercase letter-spacing: 2px">
                                Balance Running Low
                            </h1>
                        </td>
                    </tr>
                    
                    <!-- Balance Display -->
                    <tr>
                        <td style="padding: 40px 30px text-align: center">
                            <div style="background: linear-gradient(135deg, #1c1917 0%, #292524 100%) border-radius: 12px padding: 30px margin-bottom: 30px border: 2px solid #f59e0b">
                                <p style="margin: 0 0 10px 0 color: #fcd34d font-size: 14px text-transform: uppercase letter-spacing: 3px">Current Balance</p>
                                <p style="margin: 0 color: #fffbeb font-size: 56px font-weight: 900">
                                    ৳${balance.toFixed(2)}
                                </p>
                                <p style="margin: 10px 0 0 0 color: #fbbf24 font-size: 16px font-weight: 600">Getting Low...</p>
                            </div>
                            
                            <p style="color: #fef3c7 font-size: 20px line-height: 1.6 margin: 0 0 25px 0">
                                <strong>Bruh, wake up!</strong><br>
                                Your DESCO balance is looking kinda sad right now.
                            </p>
                            
                            <p style="color: #fcd34d font-size: 16px line-height: 1.8 margin: 0 0 30px 0 font-style: italic">
                                You really gonna let your lights go dark like your future? Don't be that person sitting in the dark contemplating poor life choices.
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Account Details -->
                    <tr>
                        <td style="padding: 0 30px 30px 30px">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: rgba(0,0,0,0.4) border-radius: 8px overflow: hidden">
                                <tr>
                                    <td style="padding: 15px 20px border-bottom: 1px solid #78716c">
                                        <span style="color: #fcd34d font-size: 12px text-transform: uppercase letter-spacing: 1px">Account No</span>
                                        <p style="margin: 5px 0 0 0 color: #ffffff font-size: 18px font-weight: 600 font-family: 'Courier New', monospace">${accountNo}</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 15px 20px">
                                        <span style="color: #fcd34d font-size: 12px text-transform: uppercase letter-spacing: 1px">Meter No</span>
                                        <p style="margin: 5px 0 0 0 color: #ffffff font-size: 18px font-weight: 600 font-family: 'Courier New', monospace">${meterNo}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- CTA Button -->
                    <tr>
                        <td style="padding: 0 30px 40px 30px text-align: center">
                            <a href="https://prepaid.desco.org.bd/" style="display inline block background linear gradient(90deg, #f59e0b 0%, #d97706 100%) color #0c0a0a text decoration none padding 18px 50px border radius 50px font size 18px font weight 700 text transform uppercase letter spacing 2px box shadow 0 10px 30px rgba(245, 158, 11, 0.4)">
                                ⚡ RECHARGE NOW ⚡
                            </a>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: rgba(0,0,0,0.5) padding: 20px text-align: center">
                            <p style="margin: 0 color: #a1a1aa font-size: 12px">
                                Get your act together. Seriously. 💪
                            </p>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}
