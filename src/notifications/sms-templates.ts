import { AlertAction } from '../core/alert-machine';
import { MeterContext } from './telegram-templates';
import { Tone } from '../core/tone';

// SMS costs money per 160-char GSM segment. Plain ASCII only ("Tk" not the
// taka sign - non-GSM chars force UCS-2 and triple the cost), one segment max.

const DEFAULT_RECHARGE_HOST = 'prepaid.desco.org.bd';

function label(ctx: MeterContext): string {
  return ctx.nickname ?? `meter ${ctx.meterNo}`;
}

function rechargeHost(ctx: MeterContext): string {
  try {
    const u = new URL(ctx.rechargeUrl ?? `https://${DEFAULT_RECHARGE_HOST}/`);
    return u.host;
  } catch {
    return DEFAULT_RECHARGE_HOST;
  }
}

export function smsAlertText(
  action: AlertAction,
  ctx: MeterContext,
  tone: Tone = 'savage'
): string | null {
  const balance = ctx.balance.toFixed(2);
  const host = rechargeHost(ctx);
  const mild = tone === 'mild';
  switch (action) {
    case 'low-alert':
      return mild
        ? `PowerRoast: ${label(ctx)} balance Tk${balance} is low (under Tk${ctx.lowThreshold}). Recharge: ${host}`
        : `PowerRoast: ${label(ctx)} balance Tk${balance} - LOW (under Tk${ctx.lowThreshold}). Recharge: ${host}`;
    case 'critical-alert':
      return mild
        ? `PowerRoast: ${label(ctx)} balance Tk${balance} critically low. Power cut soon - please recharge: ${host}`
        : `PowerRoast: ${label(ctx)} balance Tk${balance} - CRITICAL! Power cut imminent. Recharge NOW: ${host}`;
    // reminders/recovery aren't worth a paid segment - Telegram covers those
    case 'reminder':
    case 'recovery':
    case 'none':
      return null;
  }
}
