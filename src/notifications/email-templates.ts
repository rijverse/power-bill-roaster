import { AlertAction } from '../core/alert-machine';
import { formatDaysLeft } from '../core/prediction';
import { Tone } from '../core/tone';
import { alertCopy, meterLabel, rechargeUrl, MeterContext } from './alert-copy';
import { renderEmail } from './email-card';
import { EmailContent } from '../types';

function predictionSentence(ctx: MeterContext): string {
  if (!ctx.prediction) {
    return '';
  }
  return ` At ৳${ctx.prediction.burnPerDay.toFixed(0)}/day that's ${formatDaysLeft(
    ctx.prediction.daysLeft
  )} to ৳0.`;
}

/**
 * Renders the email for an alert. The wording comes from alertCopy(); this owns
 * the card layout and the plain-text alternative. Email is free, so (unlike SMS)
 * reminders and recovery notices go out too. Recovery is good news with nothing
 * to act on, so it drops the run-out projection and the recharge line. Returns
 * null for 'none'.
 */
export function emailAlert(
  action: AlertAction,
  ctx: MeterContext,
  tone: Tone = 'savage'
): EmailContent | null {
  const copy = alertCopy(action, ctx, tone);
  if (!copy) {
    return null;
  }

  const label = meterLabel(ctx);
  const url = rechargeUrl(ctx);
  const actionable = action !== 'recovery';
  const pitch = actionable ? `${copy.body}${predictionSentence(ctx)}` : copy.body;

  const lines = [copy.title, ``, `Balance: ৳${ctx.balance.toFixed(2)} on ${label}.`, pitch];
  if (copy.roast) {
    lines.push(copy.roast);
  }
  if (actionable) {
    lines.push(``, `Recharge: ${url}`);
  }

  const { cardTitle, ...style } = copy.email;
  return {
    subject: copy.title,
    text: lines.join('\n'),
    html: renderEmail({
      ...style,
      title: cardTitle,
      balance: ctx.balance,
      pitch,
      roast: copy.roast,
      accountNo: ctx.accountNo,
      meterNo: ctx.meterNo,
      footer: `You're getting this because you set up Power Roast alerts for ${label}.`,
      rechargeUrl: url,
    }),
  };
}
