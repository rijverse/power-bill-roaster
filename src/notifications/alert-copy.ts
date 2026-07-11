// The single source of truth for alert wording. Every channel renderer
// (Telegram, Discord, email, SMS) formats the atoms this module returns instead
// of authoring its own copy, so a title can't drift between channels - it did:
// the critical title read "Stone Age Imminent" on Telegram/Discord but
// "You're About to Live in the Stone Age" in email. Adding a third tone is now
// one edit here rather than a ternary in four files.
//
// This module owns the *words*; each channel owns its *layout* (Telegram's
// Markdown, Discord's embed, the email card, the one-segment SMS). Prediction
// wording stays per-channel because each formats the run-out line differently.

import { AlertAction } from '../core/alert-machine';
import { RunOutPrediction } from '../core/prediction';
import { DEFAULT_RECHARGE_URL } from '../core/recharge';
import { Tone } from '../core/tone';

export interface MeterContext {
  nickname: string | null;
  accountNo: string;
  meterNo: string;
  balance: number;
  lowThreshold: number;
  criticalThreshold: number;
  prediction?: RunOutPrediction | null;
  /** Override the default DESCO recharge URL (default: https://prepaid.desco.org.bd/). */
  rechargeUrl?: string;
}

// Re-exported so channel renderers can reach it without importing from core/.
// config.ts resolves rechargeUrl for the hosted path and the CLI passes it
// explicitly; the fallback only matters if a caller builds a MeterContext
// without one.
export { DEFAULT_RECHARGE_URL };

/** "Flat 3B (meter 123)" or "meter 123" - the long-form label for chat/email. */
export function meterLabel(ctx: MeterContext): string {
  return ctx.nickname ? `${ctx.nickname} (meter ${ctx.meterNo})` : `meter ${ctx.meterNo}`;
}

/** SMS uses the bare nickname (no parenthetical) to save segment characters. */
export function smsLabel(ctx: MeterContext): string {
  return ctx.nickname ?? `meter ${ctx.meterNo}`;
}

export function rechargeUrl(ctx: MeterContext): string {
  return ctx.rechargeUrl ?? DEFAULT_RECHARGE_URL;
}

/** Just the host, for SMS (a full URL would blow the one-segment budget). */
export function rechargeHost(ctx: MeterContext): string {
  try {
    return new URL(rechargeUrl(ctx)).host;
  } catch {
    return new URL(DEFAULT_RECHARGE_URL).host;
  }
}

/** Channel-agnostic styling + preheader for the email card. */
export interface EmailStyle {
  badge: string;
  accent: string;
  bg: string;
  /** The card's banner title (distinct from the subject line). */
  cardTitle: string;
  balanceLabel: string;
  preheader: string;
}

export interface AlertCopy {
  /** Headline with emoji, no channel markup. Telegram bolds it, Discord uses it
   *  as the embed title, email as the subject. */
  title: string;
  /** Primary body paragraph, thresholds already interpolated. */
  body: string;
  /** Secondary flavor line. '' when the action/tone has none. */
  roast: string;
  /** One GSM-7 segment of ASCII, or null when the action isn't worth a paid SMS. */
  sms: string | null;
  email: EmailStyle;
}

/**
 * Resolve the copy for an (action, tone). Returns null for 'none' (nothing to
 * send). tone defaults to savage - the original Power·Roast voice - so any
 * caller that forgets to pass one still gets valid copy.
 */
export function alertCopy(action: AlertAction, ctx: MeterContext, tone: Tone = 'savage'): AlertCopy | null {
  const mild = tone === 'mild';
  const bal = ctx.balance.toFixed(2);
  const label = meterLabel(ctx);
  const slabel = smsLabel(ctx);
  const host = rechargeHost(ctx);
  const low = ctx.lowThreshold;
  const crit = ctx.criticalThreshold;

  switch (action) {
    case 'low-alert':
      return {
        title: mild
          ? '⚡ Heads-up: your balance is running low'
          : '⚡ Your Electricity Is About to Ghost You',
        body: mild
          ? `You're under ৳${low}. A good time to top up before it runs out.`
          : `You're under ৳${low}. The fridge is nervous. The WiFi router is writing its will.`,
        roast: mild
          ? 'A quick recharge now saves a scramble later.'
          : 'Recharge before this becomes a candle-lit situation.',
        sms: mild
          ? `PowerRoast: ${slabel} balance Tk${bal} is low (under Tk${low}). Recharge: ${host}`
          : `PowerRoast: ${slabel} balance Tk${bal} - LOW (under Tk${low}). Recharge: ${host}`,
        email: {
          badge: '⚡',
          accent: '#f59e0b',
          bg: '#1a160a',
          cardTitle: 'Running Low',
          balanceLabel: 'Running low',
          preheader: `৳${bal} left on ${label}.`,
        },
      };
    case 'critical-alert':
      return {
        title: mild ? '🔴 Balance critically low' : '💀 EMERGENCY: Stone Age Imminent',
        body: mild
          ? `You're under ৳${crit} - power may be cut soon.`
          : `This is not a drill. You're under ৳${crit}. DESCO is about to cut you off and you'll be charging your phone at a tea stall like it's 2005.`,
        roast: mild
          ? 'Please recharge as soon as you can.'
          : 'Your neighbors are judging you. Just saying.',
        sms: mild
          ? `PowerRoast: ${slabel} balance Tk${bal} critically low. Power cut soon - please recharge: ${host}`
          : `PowerRoast: ${slabel} balance Tk${bal} - CRITICAL! Power cut imminent. Recharge NOW: ${host}`,
        email: {
          badge: mild ? '🔴' : '💀⚡',
          accent: '#dc2626',
          bg: '#1a0a0a',
          cardTitle: mild ? 'Critically Low' : 'Power Emergency',
          balanceLabel: 'Critically low',
          preheader: mild
            ? `৳${bal} left - power may be cut soon.`
            : `৳${bal} left. DESCO is about to pull the plug.`,
        },
      };
    case 'reminder':
      return {
        title: mild
          ? '🔔 Reminder: balance still low'
          : '🔁 Still Low. Still Waiting. Still Judging.',
        body: mild
          ? 'Just a gentle nudge - the balance is still low.'
          : "Yesterday's warning apparently didn't land. The balance didn't recharge itself overnight - shocking, I know.",
        roast: mild
          ? 'Whenever you get a moment, a top-up will clear this.'
          : `Under ৳${low}. I'll keep nagging. It's my whole job.`,
        // reminders aren't worth a paid segment - Telegram/email cover them
        sms: null,
        email: {
          badge: mild ? '🔔' : '🔁',
          accent: '#f59e0b',
          bg: '#1a160a',
          cardTitle: 'Still Low',
          balanceLabel: 'Still low',
          preheader: `Still ৳${bal} on ${label}.`,
        },
      };
    case 'recovery':
      return {
        title: mild ? '✅ Balance topped up' : '✅ Look Who Remembered How Money Works',
        body: mild
          ? 'Your balance is healthy again.'
          : 'Balance is healthy again. The lights live to shine another day.',
        roast: mild ? 'Thanks for keeping it topped up.' : "I'll be watching. Always watching.",
        sms: null,
        email: {
          badge: '✅',
          accent: '#16a34a',
          bg: '#0a1a0f',
          cardTitle: mild ? 'Topped Up' : 'Crisis Averted',
          balanceLabel: 'Healthy again',
          preheader: `Back to ৳${bal} on ${label}.`,
        },
      };
    case 'none':
      return null;
  }
}
