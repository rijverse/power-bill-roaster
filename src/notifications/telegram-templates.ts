import { AlertAction } from '../core/alert-machine';
import { formatDaysLeft } from '../core/prediction';
import { Tone } from '../core/tone';
import { alertCopy, meterLabel, rechargeUrl, MeterContext } from './alert-copy';

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

/**
 * Render an alert for Telegram (Markdown). Pulls its wording from alertCopy()
 * and lays it out with the balance/meter header, run-out projection, and
 * recharge link. Recovery is good news with nothing to act on, so it drops the
 * projection and the recharge link. Returns null for 'none'.
 */
export function renderAlert(
  action: AlertAction,
  ctx: MeterContext,
  tone: Tone = 'savage'
): string | null {
  const copy = alertCopy(action, ctx, tone);
  if (!copy) {
    return null;
  }
  const lines = [`*${copy.title}*`, ``, balanceLine(ctx), `📟 ${meterLabel(ctx)}`, ``, copy.body];
  if (copy.roast) {
    lines.push(copy.roast);
  }
  if (action !== 'recovery') {
    lines.push(...predictionLine(ctx));
    lines.push(``, `Recharge: ${rechargeUrl(ctx)}`);
  }
  return lines.join('\n');
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
