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
  return `💀 POWER EMERGENCY 💀

THIS IS NOT A DRILL!

Current Balance: ৳${balance.toFixed(2)} (CRITICALLY LOW)

Your balance is in the danger zone. That's like, TWO digits. Do you even know how numbers work?

Account: ${accountNo}
Meter: ${meterNo}

DESCO is about to cut your power and you'll be out here charging your phone at McDonald's like it's 2005. Is that the life you want? Living off their WiFi, pretending to order fries?

RECHARGE RIGHT NOW → https://prepaid.desco.org.bd/

Or accept your fate as someone who literally can't keep the lights on. Your call, but make it quick before you can't even read this email.

P.S. - Your neighbors are judging you. Just saying.`;
}

function generateHtml(balance: number, accountNo: string, meterNo: string): string {
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0 padding: 0 font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif background-color: #0d0d0d">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0d0d0d">
        <tr>
            <td align="center" style="padding: 40px 20px">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #1a0a0a 0%, #2d0a0a 100%) border-radius: 16px overflow: hidden box-shadow: 0 25px 50px rgba(255, 0, 0, 0.3)">
                    
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(90deg, #dc2626 0%, #991b1b 100%) padding: 30px text-align: center">
                            <div style="font-size: 64px margin-bottom: 10px">💀⚡💀</div>
                            <h1 style="margin: 0 color: #ffffff font-size: 28px font-weight: 800 text-transform: uppercase letter-spacing: 2px text-shadow: 2px 2px 4px rgba(0,0,0,0.5)">
                                POWER EMERGENCY
                            </h1>
                        </td>
                    </tr>
                    
                    <!-- Balance Display -->
                    <tr>
                        <td style="padding: 40px 30px text-align: center">
                            <div style="background: linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%) border-radius: 12px padding: 30px margin-bottom: 30px border: 2px solid #dc2626">
                                <p style="margin: 0 0 10px 0 color: #fca5a5 font-size: 14px text-transform: uppercase letter-spacing: 3px">Current Balance</p>
                                <p style="margin: 0 color: #fef2f2 font-size: 56px font-weight: 900">
                                    ৳${balance.toFixed(2)}
                                </p>
                                <p style="margin: 10px 0 0 0 color: #f87171 font-size: 18px font-weight: 600">⚠️ CRITICALLY LOW ⚠️</p>
                            </div>
                            
                            <p style="color: #fecaca font-size: 20px line-height: 1.6 margin: 0 0 25px 0">
                                <strong>THIS IS NOT A DRILL!</strong><br>
                                Your balance is in the danger zone. DESCO will cut your power any moment now.
                            </p>
                            
                            <p style="color: #f87171 font-size: 16px line-height: 1.8 margin: 0 0 30px 0 font-style: italic">
                                You'll be charging your phone at McDonald's like it's 2005. Is that the life you want? Living off their WiFi, pretending to order fries?
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Account Details -->
                    <tr>
                        <td style="padding: 0 30px 30px 30px">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: rgba(0,0,0,0.4) border-radius: 8px overflow: hidden">
                                <tr>
                                    <td style="padding: 15px 20px border-bottom: 1px solid #7f1d1d">
                                        <span style="color: #fca5a5 font-size: 12px text-transform: uppercase letter-spacing: 1px">Account No</span>
                                        <p style="margin: 5px 0 0 0 color: #ffffff font-size: 18px font-weight: 600 font-family: 'Courier New', monospace">${accountNo}</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 15px 20px">
                                        <span style="color: #fca5a5 font-size: 12px text-transform: uppercase letter-spacing: 1px">Meter No</span>
                                        <p style="margin: 5px 0 0 0 color: #ffffff font-size: 18px font-weight: 600 font-family: 'Courier New', monospace">${meterNo}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- CTA Button -->
                    <tr>
                        <td style="padding: 0 30px 40px 30px text-align: center">
                            <a href="https://prepaid.desco.org.bd/" style="display inline block background linear gradient(90deg, #dc2626 0%, #b91c1c 100%) color #ffffff text decoration none padding 18px 50px border radius 50px font size 18px font weight 700 text transform uppercase letter spacing 2px box shadow 0 10px 30px rgba(220, 38, 38, 0.5)">
                                ⚡ RECHARGE NOW ⚡
                            </a>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: rgba(0,0,0,0.5) padding: 20px text-align: center">
                            <p style="margin: 0 color: #a1a1aa font-size: 12px">
                                P.S. - Your neighbors are judging you. Just saying. 👀
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
