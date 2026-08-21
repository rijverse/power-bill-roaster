import { Db, schema } from '../db';
import { ServerConfig } from '../config';
import { getProvider } from '../providers';
import { RateLimiter } from '../core/rate-limiter';
import { effectiveMeterLimit, smsPerMonthFor, billingLive } from '../core/plans';
import { predictRunOut, formatDaysLeft } from '../core/prediction';
import { signDashboardToken } from '../web/token';
import { eraseUser } from '../core/erase-user';
import { normalizeTone } from '../core/tone';
import { isValidDiscordWebhookUrl, DiscordEmbed } from '../notifications/discord';
import {
  connectDiscordWebhook,
  disableDiscordWebhook,
  discordWebhook,
} from '../core/discord-connect';
import {
  findUserByIdentity,
  activeMeters,
  recentPrediction,
  setTone,
  stopMonitoring,
  stopConfirmed,
  STOP_NOTHING_TO_DO,
} from '../core/meter-usecases';
import { SubscriptionService } from '../billing';
import { signDiscordLinkToken } from '../web/user-auth';
import { DiscordMessagePayload } from './api';
import { maskWebhookUrl } from '../logger';

// The Discord counterpart of src/bot (Telegram). Slash commands replace the
// Telegram bot's conversational flows - options are typed and required, so
// there is no multi-step registration state to keep. Shared state changes go
// through core/meter-usecases; this file is Discord-flavored glue and copy.

// interaction / response type constants (discord API v10)
const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const DEFERRED_CHANNEL_MESSAGE = 5;
const EPHEMERAL = 1 << 6;

const DASHBOARD_LINK_TTL_MS = 24 * 60 * 60 * 1000;

// Same politeness caps as the Telegram bot, keyed by Discord user id.
const DESCO_LOOKUPS_PER_WINDOW = 6;
const DESCO_LOOKUP_WINDOW_MS = 10 * 60 * 1000;
const WEBHOOK_TESTS_PER_WINDOW = 5;
const WEBHOOK_TEST_WINDOW_MS = 10 * 60 * 1000;

// gold / red / green, matching the alert embeds in discord-templates
const COLOR = { ok: 0x3ba55d, low: 0xfbb024, critical: 0xe23b3b } as const;

function helpText(appUrl: string): string {
  return [
    '⚡ **Power Roast** - your brutally honest prepaid balance watchdog.',
    '',
    `Add meters, set thresholds, and rename them on your dashboard: ${appUrl}`,
    '',
    '`/balance` - check balances right now',
    '`/meters` - list your registered meters',
    '`/tone` - savage or mild alerts',
    '`/webhook` - also post alerts to a channel webhook',
    '`/connect` - connect this Discord to your web account',
    '`/plan` - your current plan',
    '`/dashboard` - balance history charts in your browser',
    '`/stop` - pause all monitoring',
    '`/delete` - erase your account and all data',
    '`/privacy` - what we store and why',
    '',
    'Alerts arrive as DMs from this bot - make sure DMs from server members are on.',
  ].join('\n');
}

const PRIVACY_TEXT = [
  '🔒 **Privacy, the short version**',
  '',
  '**What I store:** your Discord user id, the account & meter numbers you register, the balance history I read for them, and any alert channel you add (e.g. a channel webhook URL - /delete removes it).',
  '**Why:** that is literally the product - I cannot watch a balance without them.',
  '**What I never do:** sell or share your data, message anyone but you, or store DESCO credentials (there are none - balances are read with just the account/meter numbers).',
  '**Leaving:** /stop pauses all monitoring immediately. /delete erases your account and every byte of your data - no questions asked.',
  '',
  '_Power Roast is an independent project, not affiliated with DESCO._',
].join('\n');

interface InteractionOption {
  name: string;
  value?: string | number | boolean;
}

/** The slice of Discord's interaction payload the router reads. */
export interface Interaction {
  type: number;
  token?: string;
  data?: { name?: string; options?: InteractionOption[] };
  member?: { user?: { id?: string } };
  user?: { id?: string };
}

/**
 * The router's verdict on one interaction. `immediate` goes back as the HTTP
 * response (Discord requires it within 3 seconds). `followUp`, when present,
 * is the slow work (DESCO round-trips, webhook test sends) - the web layer
 * runs it after responding and PATCHes the result over the deferred
 * placeholder.
 */
export interface InteractionReply {
  immediate: Record<string, unknown>;
  followUp?: () => Promise<DiscordMessagePayload>;
}

export interface DiscordBot {
  handleInteraction(interaction: Interaction): Promise<InteractionReply>;
}

function reply(payload: DiscordMessagePayload | string): InteractionReply {
  const data = typeof payload === 'string' ? { content: payload } : payload;
  // Everything is ephemeral: balances, dashboard tokens, and account state
  // have no business sitting in a public channel's scrollback.
  return { immediate: { type: CHANNEL_MESSAGE, data: { ...data, flags: EPHEMERAL } } };
}

function deferred(followUp: () => Promise<DiscordMessagePayload>): InteractionReply {
  return { immediate: { type: DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } }, followUp };
}

function optionMap(options: InteractionOption[] | undefined): Map<string, string | number> {
  const map = new Map<string, string | number>();
  for (const option of options ?? []) {
    if (typeof option.value === 'string' || typeof option.value === 'number') {
      map.set(option.name, option.value);
    }
  }
  return map;
}

export function createDiscordBot(
  db: Db,
  config: ServerConfig,
  subscriptions: SubscriptionService
): DiscordBot {
  const descoLookups = new RateLimiter(DESCO_LOOKUPS_PER_WINDOW, DESCO_LOOKUP_WINDOW_MS);
  const webhookTests = new RateLimiter(WEBHOOK_TESTS_PER_WINDOW, WEBHOOK_TEST_WINDOW_MS);
  const live = billingLive(config.billing);
  const appUrl = `${config.publicBaseUrl.replace(/\/+$/, '')}/app`;
  const HELP_TEXT = helpText(appUrl);
  // Accounts are created on the web now; point unlinked Discord users there.
  const signupPointer =
    `You don't have an account yet. Sign up (or sign in) at ${appUrl}, then connect ` +
    'Discord from your dashboard. Already use the Telegram bot? Run /telegram here to link it.';

  const identity = (discordUserId: string) => ({ kind: 'discord' as const, discordUserId });

  function meterLabel(meter: schema.Meter): string {
    return meter.nickname ?? `meter ${meter.meterNo}`;
  }

  function balanceEmbed(
    meter: schema.Meter,
    balance: number,
    prediction: ReturnType<typeof predictRunOut>,
    mild: boolean
  ): DiscordEmbed {
    const critical = balance < meter.criticalThreshold;
    const low = balance < meter.lowThreshold;
    const status = critical
      ? mild
        ? 'Critically low - power may be cut soon.'
        : 'DEFCON 1. Recharge before you meet your ancestors by candlelight.'
      : low
        ? mild
          ? 'Running low - a good time to top up.'
          : 'Running low. The WiFi router is getting nervous.'
        : mild
          ? 'Looking healthy.'
          : 'Healthy. For now. I said what I said.';
    const fields: NonNullable<DiscordEmbed['fields']> = [
      { name: 'Balance', value: `৳${balance.toFixed(2)}`, inline: true },
      {
        name: 'Thresholds',
        value: `warn ৳${meter.lowThreshold} / critical ৳${meter.criticalThreshold}`,
        inline: true,
      },
    ];
    if (prediction) {
      fields.push({
        name: 'Projected run-out',
        value: `${formatDaysLeft(prediction.daysLeft)} at ৳${prediction.burnPerDay.toFixed(0)}/day`,
      });
    }
    return {
      title: `📟 ${meterLabel(meter)}`,
      description: status,
      color: critical ? COLOR.critical : low ? COLOR.low : COLOR.ok,
      fields,
    };
  }

  async function handleBalance(discordUserId: string): Promise<InteractionReply> {
    const user = await findUserByIdentity(db, identity(discordUserId));
    const meters = user ? await activeMeters(db, user.id) : [];
    if (!user || meters.length === 0) {
      return reply(`No meters yet. Add one on your dashboard: ${appUrl}`);
    }
    if (!descoLookups.allow(discordUserId)) {
      return reply(
        "Easy there. You've checked enough for now - I'm not DDoSing DESCO for you. Try again in a few minutes (alerts still run on schedule)."
      );
    }
    const mild = normalizeTone(user.tonePref) === 'mild';
    return deferred(async () => {
      const embeds: DiscordEmbed[] = [];
      const failures: string[] = [];
      for (const meter of meters) {
        try {
          const data = await getProvider(meter.provider).getBalance({
            accountNo: meter.accountNo,
            meterNo: meter.meterNo,
          });
          const prediction = await recentPrediction(db, meter.id, data.balance);
          embeds.push(balanceEmbed(meter, data.balance, prediction, mild));
        } catch {
          failures.push(`Couldn't reach DESCO for meter ${meter.meterNo} right now.`);
        }
      }
      return {
        content: failures.length > 0 ? failures.join('\n') : undefined,
        embeds: embeds.length > 0 ? embeds : undefined,
      };
    });
  }

  async function handleMeters(discordUserId: string): Promise<InteractionReply> {
    const user = await findUserByIdentity(db, identity(discordUserId));
    const meters = user ? await activeMeters(db, user.id) : [];
    if (meters.length === 0) {
      return reply(`No meters yet. Add one on your dashboard: ${appUrl}`);
    }
    return reply(
      meters
        .map(
          m =>
            `📟 ${m.nickname ?? m.meterNo} - account ${m.accountNo}, thresholds ৳${m.lowThreshold}/৳${m.criticalThreshold}`
        )
        .join('\n')
    );
  }

  async function handlePlan(discordUserId: string): Promise<InteractionReply> {
    const user = await findUserByIdentity(db, identity(discordUserId));
    if (!user) {
      return reply(signupPointer);
    }
    const lines = [
      `Plan: **${user.plan}**`,
      `Meters: up to ${effectiveMeterLimit(user)}`,
      `SMS budget: ${smsPerMonthFor(user.plan)}/month`,
    ];
    const subscription = await subscriptions.activeFor(user.id);
    if (subscription?.currentPeriodEnd) {
      lines.push(`Renews/expires: ${subscription.currentPeriodEnd.toDateString()}`);
    }
    if (user.plan === 'free') {
      lines.push(
        '',
        live
          ? 'Upgrades (SMS alerts, more meters) currently happen through the Telegram bot.'
          : 'SMS alerts and more meters are coming soon.'
      );
    }
    return reply(lines.join('\n'));
  }

  async function handleDashboard(discordUserId: string): Promise<InteractionReply> {
    const user = await findUserByIdentity(db, identity(discordUserId));
    if (!user) {
      return reply(signupPointer);
    }
    const token = signDashboardToken(
      user.id,
      Date.now() + DASHBOARD_LINK_TTL_MS,
      config.dashboardSecret
    );
    return reply(
      [
        'Your dashboard (link valid 24h, then ask me again):',
        `${config.publicBaseUrl}/dash?t=${token}`,
      ].join('\n')
    );
  }

  async function handleTone(discordUserId: string, style: string): Promise<InteractionReply> {
    const user = await findUserByIdentity(db, identity(discordUserId));
    if (!user) {
      return reply(signupPointer);
    }
    const tone = normalizeTone(style);
    await setTone(db, user.id, tone);
    return reply(
      tone === 'mild'
        ? 'Tone set to mild 🥛 - gentle nudges only.'
        : 'Tone set to savage 🌶️ - you asked for this.'
    );
  }

  // Mirrors the Telegram /discord command: no url = status, "off" = pause,
  // otherwise validate + test-send + save. Channel type 'discord' is the
  // webhook channel, shared with Telegram-managed rows.
  async function handleWebhook(
    discordUserId: string,
    url: string | null
  ): Promise<InteractionReply> {
    const user = await findUserByIdentity(db, identity(discordUserId));
    if (!user) {
      return reply(signupPointer);
    }
    const existing = await discordWebhook(db, user.id);
    const howTo =
      'In Discord: Server Settings > Integrations > Webhooks > New Webhook > Copy URL, then run /webhook with that url.';

    if (!url) {
      if (existing?.enabled) {
        return reply(
          `Channel-webhook alerts are on → ${maskWebhookUrl(existing.address)}\nRun /webhook url:off to stop, or pass a new url to move them.`
        );
      }
      if (existing) {
        return reply(
          'Webhook alerts are set up but paused. Pass the url again to turn them back on.'
        );
      }
      return reply(`No channel webhook connected yet. ${howTo}`);
    }

    if (url.toLowerCase() === 'off') {
      if ((await disableDiscordWebhook(db, user.id)) === 'not-on') {
        return reply("Webhook alerts aren't on, so there's nothing to turn off.");
      }
      return reply('Webhook alerts paused. Pass the url again to turn them back on.');
    }

    // Reject a malformed URL before the throttle, so a typo doesn't cost a test send.
    if (!isValidDiscordWebhookUrl(url)) {
      return reply(`That doesn't look like a Discord webhook URL. ${howTo}`);
    }
    if (!webhookTests.allow(discordUserId)) {
      return reply('Too many webhook test sends. Give it a few minutes and try again.');
    }
    // the test send is a network call - defer like the other slow paths
    return deferred(async () => {
      const result = await connectDiscordWebhook(db, user.id, url);
      if (!result.ok) {
        return {
          content:
            "Couldn't post to that webhook - Discord rejected it. Make sure the URL is current (webhooks can be deleted) and try again.",
        };
      }
      return {
        content:
          "Sent a test message to that channel ✅ If you saw it, you're all set - alerts will go there too.",
      };
    });
  }

  // One account across surfaces: hand the user a web link carrying a signed
  // token with their Discord id. They open it while signed in on the web, and
  // the web side attaches this Discord id to their account (folding in a legacy
  // Discord-only account if one exists). Discord has no ?start= deep link, so the
  // connect runs bot-to-web, the opposite of the Telegram flow.
  function handleConnect(discordUserId: string): InteractionReply {
    const token = signDiscordLinkToken(discordUserId, config.dashboardSecret);
    return reply(
      [
        'Connect Discord to your Power Roast account (link valid 15 minutes):',
        `${appUrl}/connect/discord?token=${token}`,
        '',
        "Sign in on the web first if you haven't - then alerts and slash commands here share that account.",
      ].join('\n')
    );
  }

  async function handleStop(discordUserId: string): Promise<InteractionReply> {
    const user = await findUserByIdentity(db, identity(discordUserId));
    if (!user) {
      return reply(STOP_NOTHING_TO_DO);
    }
    await stopMonitoring(db, user.id);
    return reply(stopConfirmed(appUrl));
  }

  async function handleDelete(discordUserId: string, confirm: string): Promise<InteractionReply> {
    const user = await findUserByIdentity(db, identity(discordUserId));
    if (!user) {
      return reply('Nothing to delete - you have no account.');
    }
    if (confirm !== 'CONFIRM') {
      return reply(
        '⚠️ This permanently erases your account: meters, balance history, alerts, subscription - everything. No undo.\nIf you mean it, run /delete again with confirm set to CONFIRM (all caps).'
      );
    }
    await eraseUser(db, user.id);
    return reply(
      'Done. Everything is erased. It was an honor roasting you. The lights are your problem now. 🕯️'
    );
  }

  async function handleInteraction(interaction: Interaction): Promise<InteractionReply> {
    if (interaction.type === PING) {
      return { immediate: { type: PONG } };
    }
    if (interaction.type !== APPLICATION_COMMAND) {
      // component/autocomplete interactions aren't used (yet); answer politely
      // rather than erroring Discord's retry queue.
      return reply("I don't handle that kind of interaction.");
    }
    const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;
    if (!discordUserId) {
      return reply("Couldn't tell who you are - try again.");
    }
    const options = optionMap(interaction.data?.options);
    const str = (name: string) => {
      const value = options.get(name);
      return typeof value === 'string' ? value.trim() : null;
    };

    switch (interaction.data?.name) {
      case 'help':
        return reply(HELP_TEXT);
      case 'privacy':
        return reply(PRIVACY_TEXT);
      case 'balance':
        return handleBalance(discordUserId);
      case 'meters':
        return handleMeters(discordUserId);
      case 'plan':
        return handlePlan(discordUserId);
      case 'dashboard':
        return handleDashboard(discordUserId);
      case 'tone':
        return handleTone(discordUserId, str('style') ?? '');
      case 'webhook':
        return handleWebhook(discordUserId, str('url'));
      case 'connect':
        return handleConnect(discordUserId);
      case 'stop':
        return handleStop(discordUserId);
      case 'delete':
        return handleDelete(discordUserId, str('confirm') ?? '');
      default:
        return reply('Unknown command. /help lists everything I know.');
    }
  }

  return { handleInteraction };
}
