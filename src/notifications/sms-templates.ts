import { AlertAction } from '../core/alert-machine';
import { MeterContext } from './telegram-templates';
import { Tone } from '../core/tone';

// SMS costs money per 160-char GSM segment. Plain ASCII only ("Tk" not the
// taka sign - non-GSM chars force UCS-2 and triple the cost), one segment max.

function label(ctx: MeterContext): string {
  return ctx.nickname ?? `meter ${ctx.meterNo}`;
}

export function smsAlertText(
  action: AlertAction,
  ctx: MeterContext,
  tone: Tone = 'savage'
): string | null {
  const balance = ctx.balance.toFixed(2);
  const mild = tone === 'mild';
  switch (action) {
    case 'low-alert':
      return mild
        ? `PowerRoast: ${label(ctx)} balance Tk${balance} is low (under Tk${ctx.lowThreshold}). Recharge: prepaid.desco.org.bd`
        : `PowerRoast: ${label(ctx)} balance Tk${balance} - LOW (under Tk${ctx.lowThreshold}). Recharge: prepaid.desco.org.bd`;
    case 'critical-alert':
      return mild
        ? `PowerRoast: ${label(ctx)} balance Tk${balance} critically low. Power cut soon - please recharge: prepaid.desco.org.bd`
        : `PowerRoast: ${label(ctx)} balance Tk${balance} - CRITICAL! Power cut imminent. Recharge NOW: prepaid.desco.org.bd`;
    // reminders/recovery aren't worth a paid segment - Telegram covers those
    case 'reminder':
    case 'recovery':
    case 'none':
      return null;
  }
}
