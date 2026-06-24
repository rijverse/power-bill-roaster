import { AlertAction } from '../core/alert-machine';
import { RunOutPrediction, formatDaysLeft } from '../core/prediction';
import { Tone } from '../core/tone';

export interface MeterContext {
  nickname: string | null;
  accountNo: string;
  meterNo: string;
  balance: number;
  lowThreshold: number;
  criticalThreshold: number;
  prediction?: RunOutPrediction | null;
}

const RECHARGE_URL = 'https://prepaid.desco.org.bd/';

function meterLabel(ctx: MeterContext): string {
  return ctx.nickname ? `${ctx.nickname} (meter ${ctx.meterNo})` : `meter ${ctx.meterNo}`;
}

function balanceLine(ctx: MeterContext): string {
  return `💰 Balance: ৳${ctx.balance.toFixed(2)}`;
}

function predictionLine(ctx: MeterContext): string[] {
  if (!ctx.prediction) {
    return [];
  }
  return [
    `🔮 At your current burn rate (৳${ctx.prediction.burnPerDay.toFixed(0)}/day): ${formatDaysLeft(ctx.prediction.daysLeft)} until ৳0.`,
  ];
}

export function lowAlertMessage(ctx: MeterContext, tone: Tone = 'savage'): string {
  const head =
    tone === 'mild'
      ? [`⚡ *Heads-up: your balance is running low*`]
      : [`⚡ *Your Electricity Is About to Ghost You*`];
  const body =
    tone === 'mild'
      ? `You're under ৳${ctx.lowThreshold}. A good time to top up before it runs out.`
      : `You're under ৳${ctx.lowThreshold}. The fridge is nervous. The WiFi router is writing its will.`;
  return [
    ...head,
    ``,
    balanceLine(ctx),
    `📟 ${meterLabel(ctx)}`,
    ``,
    body,
    ...predictionLine(ctx),
    ``,
    `Recharge: ${RECHARGE_URL}`,
  ].join('\n');
}

export function criticalAlertMessage(ctx: MeterContext, tone: Tone = 'savage'): string {
  if (tone === 'mild') {
    return [
      `🔴 *Balance critically low*`,
      ``,
      balanceLine(ctx),
      `📟 ${meterLabel(ctx)}`,
      ``,
      `You're under ৳${ctx.criticalThreshold} — power may be cut soon. Please recharge when you can.`,
      ...predictionLine(ctx),
      ``,
      `Recharge: ${RECHARGE_URL}`,
    ].join('\n');
  }
  return [
    `💀 *EMERGENCY: Stone Age Imminent*`,
    ``,
    balanceLine(ctx),
    `📟 ${meterLabel(ctx)}`,
    ``,
    `THIS IS NOT A DRILL. You're under ৳${ctx.criticalThreshold}. DESCO is about to cut you off and you'll be charging your phone at a tea stall like it's 2005.`,
    ...predictionLine(ctx),
    ``,
    `RECHARGE RIGHT NOW → ${RECHARGE_URL}`,
    ``,
    `P.S. Your neighbors are judging you. Just saying.`,
  ].join('\n');
}

export function reminderMessage(ctx: MeterContext, tone: Tone = 'savage'): string {
  const head =
    tone === 'mild'
      ? `🔔 *Reminder: balance still low*`
      : `🔁 *Still Low. Still Waiting. Still Judging.*`;
  const body =
    tone === 'mild'
      ? `Just a gentle nudge — the balance is still low.`
      : `Yesterday's warning apparently didn't land. The balance didn't recharge itself overnight - shocking, I know.`;
  return [
    head,
    ``,
    balanceLine(ctx),
    `📟 ${meterLabel(ctx)}`,
    ``,
    body,
    ...predictionLine(ctx),
    ``,
    `${RECHARGE_URL}`,
  ].join('\n');
}

export function recoveryMessage(ctx: MeterContext, tone: Tone = 'savage'): string {
  const head =
    tone === 'mild' ? `✅ *Balance topped up*` : `✅ *Look Who Remembered How Money Works*`;
  const body =
    tone === 'mild'
      ? `Your balance is healthy again. Thanks for keeping it topped up.`
      : `Balance is healthy again. The lights live to shine another day. I'll be watching.`;
  return [head, ``, balanceLine(ctx), `📟 ${meterLabel(ctx)}`, ``, body].join('\n');
}

export function renderAlert(
  action: AlertAction,
  ctx: MeterContext,
  tone: Tone = 'savage'
): string | null {
  switch (action) {
    case 'low-alert':
      return lowAlertMessage(ctx, tone);
    case 'critical-alert':
      return criticalAlertMessage(ctx, tone);
    case 'reminder':
      return reminderMessage(ctx, tone);
    case 'recovery':
      return recoveryMessage(ctx, tone);
    case 'none':
      return null;
  }
}

export function balanceStatusMessage(ctx: MeterContext): string {
  const status =
    ctx.balance < ctx.criticalThreshold
      ? '💀 CRITICAL'
      : ctx.balance < ctx.lowThreshold
        ? '⚠️ LOW'
        : '✅ OK';
  return [
    `📟 ${meterLabel(ctx)}`,
    balanceLine(ctx),
    `Status: ${status}`,
    ...predictionLine(ctx),
  ].join('\n');
}
