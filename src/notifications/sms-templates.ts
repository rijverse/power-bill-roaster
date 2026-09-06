import { AlertAction } from '../core/alert-machine';
import { Tone } from '../core/tone';
import { alertCopy, MeterContext } from './alert-copy';

/**
 * The one-segment SMS for an alert, or null when the action isn't worth a paid
 * segment (reminders and recovery ride the free channels). The text itself is
 * authored in alert-copy.ts, which keeps it plain ASCII - "Tk" rather than the
 * taka sign, since a non-GSM char forces UCS-2 and triples the cost.
 */
export function smsAlertText(
  action: AlertAction,
  ctx: MeterContext,
  tone: Tone = 'savage'
): string | null {
  return alertCopy(action, ctx, tone)?.sms ?? null;
}
