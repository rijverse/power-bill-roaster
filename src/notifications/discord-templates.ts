import { AlertAction } from '../core/alert-machine';
import { formatDaysLeft } from '../core/prediction';
import { Tone } from '../core/tone';
import { alertCopy, meterLabel, rechargeUrl, MeterContext } from './alert-copy';
import { DiscordEmbed } from './discord';

// Webhooks can't carry interactive components, so the recharge link lives inline
// in the embed description and the snooze/recheck buttons stay Telegram-only.

// gold for low, red for critical, green for recovery
const COLOR = { low: 0xfbb024, critical: 0xe23b3b, recovery: 0x3ba55d } as const;

function baseFields(ctx: MeterContext): NonNullable<DiscordEmbed['fields']> {
  const fields: NonNullable<DiscordEmbed['fields']> = [
    { name: 'Balance', value: `৳${ctx.balance.toFixed(2)}`, inline: true },
    { name: 'Meter', value: meterLabel(ctx), inline: true },
  ];
  if (ctx.prediction) {
    fields.push({
      name: 'Projected run-out',
      value: `${formatDaysLeft(ctx.prediction.daysLeft)} at ৳${ctx.prediction.burnPerDay.toFixed(0)}/day`,
    });
  }
  return fields;
}

const COLOR_FOR: Record<Exclude<AlertAction, 'none'>, number> = {
  'low-alert': COLOR.low,
  reminder: COLOR.low,
  'critical-alert': COLOR.critical,
  recovery: COLOR.recovery,
};

/**
 * Builds a Discord embed for an alert, sourcing wording from alertCopy() so it
 * can't drift from the other channels. Returns null for 'none'. Recovery is good
 * news with nothing to act on, so it drops the recharge link and the run-out
 * projection.
 */
export function discordAlertEmbed(
  action: AlertAction,
  ctx: MeterContext,
  tone: Tone = 'savage'
): DiscordEmbed | null {
  const copy = alertCopy(action, ctx, tone);
  if (!copy || action === 'none') {
    return null;
  }
  const url = rechargeUrl(ctx);
  const flavor = copy.roast ? `\n\n${copy.roast}` : '';

  if (action === 'recovery') {
    return {
      title: copy.title,
      description: copy.body + flavor,
      color: COLOR_FOR[action],
      fields: [
        { name: 'Balance', value: `৳${ctx.balance.toFixed(2)}`, inline: true },
        { name: 'Meter', value: meterLabel(ctx), inline: true },
      ],
    };
  }

  return {
    title: copy.title,
    description: `${copy.body}${flavor}\n\n[Recharge now](${url})`,
    color: COLOR_FOR[action],
    url,
    fields: baseFields(ctx),
  };
}
