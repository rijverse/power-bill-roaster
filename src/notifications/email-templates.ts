import { AlertAction } from '../core/alert-machine';
import { formatDaysLeft } from '../core/prediction';
import { MeterContext } from './telegram-templates';
import { renderEmail } from '../templates/critical';
import { EmailContent } from '../types';

const RECHARGE_URL = 'https://prepaid.desco.org.bd/';

function label(ctx: MeterContext): string {
  return ctx.nickname ? `${ctx.nickname} (meter ${ctx.meterNo})` : `meter ${ctx.meterNo}`;
}

function prediction(ctx: MeterContext): string {
  if (!ctx.prediction) {
    return '';
  }
  return ` At ৳${ctx.prediction.burnPerDay.toFixed(0)}/day that's ${formatDaysLeft(
    ctx.prediction.daysLeft
  )} to ৳0.`;
}

/**
 * Renders the email a non-Telegram user gets for an alert. Same roast voice as
 * the Telegram/SMS templates; HTML via the shared renderEmail() card. Email is
 * free, so (unlike SMS) reminders and recovery notices are sent too. Returns
 * null when the action doesn't warrant an email.
 */
export function emailAlert(action: AlertAction, ctx: MeterContext): EmailContent | null {
  const balance = ctx.balance.toFixed(2);
  const foot = `You're getting this because you set up Power Roast alerts for ${label(ctx)}.`;

  switch (action) {
    case 'low-alert':
      return {
        subject: '⚡ Your Electricity Is About to Ghost You',
        text: `Balance: ৳${balance} on ${label(ctx)}.\nYou're under ৳${ctx.lowThreshold}.${prediction(ctx)}\nRecharge: ${RECHARGE_URL}`,
        html: renderEmail({
          accent: '#f59e0b',
          bg: '#1a160a',
          badge: '⚡',
          title: 'Running Low',
          preheader: `৳${balance} left on ${label(ctx)}.`,
          balance: ctx.balance,
          balanceLabel: 'Running low',
          pitch: `You're under ৳${ctx.lowThreshold}. The fridge is nervous and the WiFi router is writing its will.${prediction(ctx)}`,
          roast: 'Recharge before this becomes a candle-lit situation.',
          accountNo: ctx.accountNo,
          meterNo: ctx.meterNo,
          footer: foot,
        }),
      };
    case 'critical-alert':
      return {
        subject: "💀 EMERGENCY: You're About to Live in the Stone Age",
        text: `CRITICAL: ৳${balance} on ${label(ctx)}.\nUnder ৳${ctx.criticalThreshold} - DESCO is about to cut you off.${prediction(ctx)}\nRecharge NOW: ${RECHARGE_URL}`,
        html: renderEmail({
          accent: '#dc2626',
          bg: '#1a0a0a',
          badge: '💀⚡',
          title: 'Power Emergency',
          preheader: `৳${balance} left. DESCO is about to pull the plug.`,
          balance: ctx.balance,
          balanceLabel: 'Critically low',
          pitch: `<strong>This is not a drill.</strong> You're under ৳${ctx.criticalThreshold}. DESCO has a finger on the switch.${prediction(ctx)}`,
          roast:
            "Recharge right now, or charge your phone at a tea stall like it's 2005. Your neighbors are judging.",
          accountNo: ctx.accountNo,
          meterNo: ctx.meterNo,
          footer: foot,
        }),
      };
    case 'reminder':
      return {
        subject: '🔁 Still Low. Still Waiting. Still Judging.',
        text: `Still low: ৳${balance} on ${label(ctx)}.\nThe balance didn't recharge itself overnight.${prediction(ctx)}\nRecharge: ${RECHARGE_URL}`,
        html: renderEmail({
          accent: '#f59e0b',
          bg: '#1a160a',
          badge: '🔁',
          title: 'Still Low',
          preheader: `Still ৳${balance} on ${label(ctx)}.`,
          balance: ctx.balance,
          balanceLabel: 'Still low',
          pitch: `Yesterday's nudge apparently didn't land - the balance didn't recharge itself overnight.${prediction(ctx)}`,
          roast: 'Under ৳' + ctx.lowThreshold + ". I'll keep nagging. It's my whole job.",
          accountNo: ctx.accountNo,
          meterNo: ctx.meterNo,
          footer: foot,
        }),
      };
    case 'recovery':
      return {
        subject: '✅ Look Who Remembered How Money Works',
        text: `Recovered: ৳${balance} on ${label(ctx)}.\nBalance is healthy again. I'll be watching.`,
        html: renderEmail({
          accent: '#16a34a',
          bg: '#0a1a0f',
          badge: '✅',
          title: 'Crisis Averted',
          preheader: `Back to ৳${balance} on ${label(ctx)}.`,
          balance: ctx.balance,
          balanceLabel: 'Healthy again',
          pitch: 'Balance is back above your thresholds. The lights live to shine another day.',
          roast: "I'll be watching. Always watching.",
          accountNo: ctx.accountNo,
          meterNo: ctx.meterNo,
          footer: foot,
        }),
      };
    case 'none':
      return null;
  }
}
