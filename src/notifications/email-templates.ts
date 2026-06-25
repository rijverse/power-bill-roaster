import { AlertAction } from '../core/alert-machine';
import { formatDaysLeft } from '../core/prediction';
import { MeterContext } from './telegram-templates';
import { Tone } from '../core/tone';
import { renderEmail } from '../templates/critical';
import { EmailContent } from '../types';

const DEFAULT_RECHARGE_URL = 'https://prepaid.desco.org.bd/';

function label(ctx: MeterContext): string {
  return ctx.nickname ? `${ctx.nickname} (meter ${ctx.meterNo})` : `meter ${ctx.meterNo}`;
}

function rechargeUrl(ctx: MeterContext): string {
  return ctx.rechargeUrl ?? DEFAULT_RECHARGE_URL;
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
export function emailAlert(
  action: AlertAction,
  ctx: MeterContext,
  tone: Tone = 'savage'
): EmailContent | null {
  const balance = ctx.balance.toFixed(2);
  const url = rechargeUrl(ctx);
  const foot = `You're getting this because you set up Power Roast alerts for ${label(ctx)}.`;
  const mild = tone === 'mild';

  switch (action) {
    case 'low-alert':
      return {
        subject: mild
          ? '⚡ Heads-up: your balance is running low'
          : '⚡ Your Electricity Is About to Ghost You',
        text: `Balance: ৳${balance} on ${label(ctx)}.\nYou're under ৳${ctx.lowThreshold}.${prediction(ctx)}\nRecharge: ${url}`,
        html: renderEmail({
          accent: '#f59e0b',
          bg: '#1a160a',
          badge: '⚡',
          title: 'Running Low',
          preheader: `৳${balance} left on ${label(ctx)}.`,
          balance: ctx.balance,
          balanceLabel: 'Running low',
          pitch: mild
            ? `You're under ৳${ctx.lowThreshold}. A good time to top up before it runs out.${prediction(ctx)}`
            : `You're under ৳${ctx.lowThreshold}. The fridge is nervous and the WiFi router is writing its will.${prediction(ctx)}`,
          roast: mild
            ? 'A quick recharge now saves a scramble later.'
            : 'Recharge before this becomes a candle-lit situation.',
          accountNo: ctx.accountNo,
          meterNo: ctx.meterNo,
          footer: foot,
          rechargeUrl: url,
        }),
      };
    case 'critical-alert':
      return {
        subject: mild
          ? '🔴 Your balance is critically low'
          : "💀 EMERGENCY: You're About to Live in the Stone Age",
        text: `CRITICAL: ৳${balance} on ${label(ctx)}.\nUnder ৳${ctx.criticalThreshold} - DESCO is about to cut you off.${prediction(ctx)}\nRecharge NOW: ${url}`,
        html: renderEmail({
          accent: '#dc2626',
          bg: '#1a0a0a',
          badge: mild ? '🔴' : '💀⚡',
          title: mild ? 'Critically Low' : 'Power Emergency',
          preheader: mild
            ? `৳${balance} left - power may be cut soon.`
            : `৳${balance} left. DESCO is about to pull the plug.`,
          balance: ctx.balance,
          balanceLabel: 'Critically low',
          pitch: mild
            ? `You're under ৳${ctx.criticalThreshold} - power may be cut soon.${prediction(ctx)}`
            : `<strong>This is not a drill.</strong> You're under ৳${ctx.criticalThreshold}. DESCO has a finger on the switch.${prediction(ctx)}`,
          roast: mild
            ? 'Please recharge as soon as you can.'
            : "Recharge right now, or charge your phone at a tea stall like it's 2005. Your neighbors are judging.",
          accountNo: ctx.accountNo,
          meterNo: ctx.meterNo,
          footer: foot,
          rechargeUrl: url,
        }),
      };
    case 'reminder':
      return {
        subject: mild
          ? '🔔 Reminder: balance still low'
          : '🔁 Still Low. Still Waiting. Still Judging.',
        text: `Still low: ৳${balance} on ${label(ctx)}.\nThe balance didn't recharge itself overnight.${prediction(ctx)}\nRecharge: ${url}`,
        html: renderEmail({
          accent: '#f59e0b',
          bg: '#1a160a',
          badge: mild ? '🔔' : '🔁',
          title: 'Still Low',
          preheader: `Still ৳${balance} on ${label(ctx)}.`,
          balance: ctx.balance,
          balanceLabel: 'Still low',
          pitch: mild
            ? `A gentle reminder - the balance is still low.${prediction(ctx)}`
            : `Yesterday's nudge apparently didn't land - the balance didn't recharge itself overnight.${prediction(ctx)}`,
          roast: mild
            ? 'Whenever you get a moment, a top-up will clear this.'
            : 'Under ৳' + ctx.lowThreshold + ". I'll keep nagging. It's my whole job.",
          accountNo: ctx.accountNo,
          meterNo: ctx.meterNo,
          footer: foot,
          rechargeUrl: url,
        }),
      };
    case 'recovery':
      return {
        subject: mild ? '✅ Balance topped up' : '✅ Look Who Remembered How Money Works',
        text: `Recovered: ৳${balance} on ${label(ctx)}.\nBalance is healthy again. I'll be watching.`,
        html: renderEmail({
          accent: '#16a34a',
          bg: '#0a1a0f',
          badge: '✅',
          title: mild ? 'Topped Up' : 'Crisis Averted',
          preheader: `Back to ৳${balance} on ${label(ctx)}.`,
          balance: ctx.balance,
          balanceLabel: 'Healthy again',
          pitch: 'Balance is back above your thresholds. The lights live to shine another day.',
          roast: mild ? 'Thanks for keeping it topped up.' : "I'll be watching. Always watching.",
          accountNo: ctx.accountNo,
          meterNo: ctx.meterNo,
          footer: foot,
          rechargeUrl: url,
        }),
      };
    case 'none':
      return null;
  }
}
