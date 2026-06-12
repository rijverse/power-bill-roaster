import { AlertAction } from '../core/alert-machine';
import { MeterContext } from './telegram-templates';

// SMS costs money per 160-char GSM segment. Plain ASCII only ("Tk" not the
// taka sign - non-GSM chars force UCS-2 and triple the cost), one segment max.

function label(ctx: MeterContext): string {
  return ctx.nickname ?? `meter ${ctx.meterNo}`;
}

export function smsAlertText(action: AlertAction, ctx: MeterContext): string | null {
  const balance = ctx.balance.toFixed(2);
  switch (action) {
    case 'low-alert':
      return `PowerRoast: ${label(ctx)} balance Tk${balance} - LOW (under Tk${ctx.lowThreshold}). Recharge: prepaid.desco.org.bd`;
    case 'critical-alert':
      return `PowerRoast: ${label(ctx)} balance Tk${balance} - CRITICAL! Power cut imminent. Recharge NOW: prepaid.desco.org.bd`;
    // reminders/recovery aren't worth a paid segment - Telegram covers those
    case 'reminder':
    case 'recovery':
    case 'none':
      return null;
  }
}
