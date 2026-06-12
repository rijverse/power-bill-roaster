import { AlertAction } from '../core/alert-machine';
import { RunOutPrediction, formatDaysLeft } from '../core/prediction';

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

export function lowAlertMessage(ctx: MeterContext): string {
  return [
    `⚡ *Your Electricity Is About to Ghost You*`,
    ``,
    balanceLine(ctx),
    `📟 ${meterLabel(ctx)}`,
    ``,
    `You're under ৳${ctx.lowThreshold}. The fridge is nervous. The WiFi router is writing its will.`,
    ...predictionLine(ctx),
    ``,
    `Recharge before this becomes a candle-lit situation: ${RECHARGE_URL}`,
  ].join('\n');
}

export function criticalAlertMessage(ctx: MeterContext): string {
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

export function reminderMessage(ctx: MeterContext): string {
  return [
    `🔁 *Still Low. Still Waiting. Still Judging.*`,
    ``,
    balanceLine(ctx),
    `📟 ${meterLabel(ctx)}`,
    ``,
    `Yesterday's warning apparently didn't land. The balance didn't recharge itself overnight - shocking, I know.`,
    ...predictionLine(ctx),
    ``,
    `${RECHARGE_URL}`,
  ].join('\n');
}

export function recoveryMessage(ctx: MeterContext): string {
  return [
    `✅ *Look Who Remembered How Money Works*`,
    ``,
    balanceLine(ctx),
    `📟 ${meterLabel(ctx)}`,
    ``,
    `Balance is healthy again. The lights live to shine another day. I'll be watching.`,
  ].join('\n');
}

export function renderAlert(action: AlertAction, ctx: MeterContext): string | null {
  switch (action) {
    case 'low-alert':
      return lowAlertMessage(ctx);
    case 'critical-alert':
      return criticalAlertMessage(ctx);
    case 'reminder':
      return reminderMessage(ctx);
    case 'recovery':
      return recoveryMessage(ctx);
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
