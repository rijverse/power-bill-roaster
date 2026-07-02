import { AlertAction } from '../core/alert-machine';
import { formatDaysLeft } from '../core/prediction';
import { Tone } from '../core/tone';
import { MeterContext } from './telegram-templates';
import { DiscordEmbed } from './discord';

// Webhooks can't carry interactive components, so the recharge link lives inline
// in the embed description and the snooze/recheck buttons stay Telegram-only.
const DEFAULT_RECHARGE_URL = 'https://prepaid.desco.org.bd/';

// gold for low, red for critical, green for recovery
const COLOR = { low: 0xfbb024, critical: 0xe23b3b, recovery: 0x3ba55d } as const;

function meterLabel(ctx: MeterContext): string {
  return ctx.nickname ? `${ctx.nickname} (meter ${ctx.meterNo})` : `meter ${ctx.meterNo}`;
}

function rechargeUrl(ctx: MeterContext): string {
  return ctx.rechargeUrl ?? DEFAULT_RECHARGE_URL;
}

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

/**
 * Builds a Discord embed for an alert, mirroring the Telegram roast copy and
 * tone. Returns null for 'none' (nothing to send). Recovery is good news with
 * nothing to act on, so it drops the recharge link and the run-out projection.
 */
export function discordAlertEmbed(
  action: AlertAction,
  ctx: MeterContext,
  tone: Tone = 'savage'
): DiscordEmbed | null {
  const mild = tone === 'mild';
  const url = rechargeUrl(ctx);
  const rechargeLine = `\n\n[Recharge now](${url})`;

  switch (action) {
    case 'low-alert':
      return {
        title: mild
          ? '⚡ Heads-up: your balance is running low'
          : '⚡ Your Electricity Is About to Ghost You',
        description:
          (mild
            ? `You're under ৳${ctx.lowThreshold}. A good time to top up before it runs out.`
            : `You're under ৳${ctx.lowThreshold}. The fridge is nervous. The WiFi router is writing its will.`) +
          rechargeLine,
        color: COLOR.low,
        url,
        fields: baseFields(ctx),
      };
    case 'reminder':
      return {
        title: mild
          ? '🔔 Reminder: balance still low'
          : '🔁 Still Low. Still Waiting. Still Judging.',
        description:
          (mild
            ? `Just a gentle nudge - the balance is still low.`
            : `Yesterday's warning apparently didn't land. The balance didn't recharge itself overnight - shocking, I know.`) +
          rechargeLine,
        color: COLOR.low,
        url,
        fields: baseFields(ctx),
      };
    case 'critical-alert':
      return {
        title: mild ? '🔴 Balance critically low' : '💀 EMERGENCY: Stone Age Imminent',
        description:
          (mild
            ? `You're under ৳${ctx.criticalThreshold} - power may be cut soon. Please recharge when you can.`
            : `THIS IS NOT A DRILL. You're under ৳${ctx.criticalThreshold}. DESCO is about to cut you off and you'll be charging your phone at a tea stall like it's 2005.`) +
          rechargeLine,
        color: COLOR.critical,
        url,
        fields: baseFields(ctx),
      };
    case 'recovery':
      return {
        title: mild ? '✅ Balance topped up' : '✅ Look Who Remembered How Money Works',
        description: mild
          ? `Your balance is healthy again. Thanks for keeping it topped up.`
          : `Balance is healthy again. The lights live to shine another day. I'll be watching.`,
        color: COLOR.recovery,
        fields: [
          { name: 'Balance', value: `৳${ctx.balance.toFixed(2)}`, inline: true },
          { name: 'Meter', value: meterLabel(ctx), inline: true },
        ],
      };
    case 'none':
      return null;
  }
}
