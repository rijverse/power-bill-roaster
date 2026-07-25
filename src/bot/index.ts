import { Bot, InlineKeyboard, Context } from 'grammy';
import { eq, and, gte } from 'drizzle-orm';
import { Db, schema } from '../db';
import { getProvider, ProviderUnavailableError } from '../providers';
import { ServerConfig } from '../config';
import { balanceStatusMessage } from '../notifications/telegram-templates';
import { RateLimiter } from '../core/rate-limiter';
import {
  effectiveMeterLimit,
  smsPerMonthFor,
  priceBdtFor,
  isPurchasablePlan,
  billingLive,
} from '../core/plans';
import { normalizeBdPhone } from '../core/phone';
import { SubscriptionService } from '../billing';
import { signDashboardToken } from '../web/token';
import { eraseUser } from '../core/erase-user';
import { normalizeTone } from '../core/tone';
import { SmsGateway } from '../notifications/sms';
import { isValidDiscordWebhookUrl } from '../notifications/discord';
import {
  connectDiscordWebhook,
  disableDiscordWebhook,
  discordWebhook,
} from '../core/discord-connect';
import { Mailer } from '../services/mailer';
import { mergeAccounts, chooseSurvivor } from '../core/merge-accounts';
import { linkIdentity } from '../core/identities';
import {
  recentPrediction,
  setTone,
  stopMonitoring,
  STOP_CONFIRMED,
  STOP_NOTHING_TO_DO,
} from '../core/meter-usecases';
import {
  signMagicLink,
  magicCode,
  signLinkToken,
  verifyLinkToken,
  verifyDiscordLinkToken,
} from '../web/user-auth';
import { sendMagicLink } from '../web/app';
import { logger, maskWebhookUrl } from '../logger';
import crypto from 'crypto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DASHBOARD_LINK_TTL_MS = 24 * 60 * 60 * 1000;
const DELETE_CONFIRM_WINDOW_MS = 60 * 1000;
// how long an alert-button "snooze" mutes reminders for that meter
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

interface PendingSmsVerification {
  phone: string;
  code: string;
  expiresAt: number;
  attempts: number;
}

const SMS_OTP_TTL_MS = 10 * 60 * 1000;
const SMS_OTP_MAX_ATTEMPTS = 3;
// OTP sends cost real money and are an SMS-pumping abuse vector - keep tight
const SMS_OTP_SENDS_PER_HOUR = 3;

// Registration verifications + on-demand /balance checks both hit DESCO;
// keep one chat from spraying their API through us.
const DESCO_LOOKUPS_PER_WINDOW = 6;
const DESCO_LOOKUP_WINDOW_MS = 10 * 60 * 1000;

// Discord webhook test sends are free but still worth a light throttle.
const DISCORD_TESTS_PER_WINDOW = 5;
const DISCORD_TEST_WINDOW_MS = 10 * 60 * 1000;

// /email link sends go to an inbox, so throttle like magic links.
const EMAIL_LINKS_PER_WINDOW = 5;
const EMAIL_LINK_WINDOW_MS = 15 * 60 * 1000;

function helpText(appUrl: string): string {
  return [
    '⚡ *Power Roast* - your brutally honest prepaid balance watchdog.',
    '',
    `Add meters, set thresholds, and rename them on your dashboard: ${appUrl}`,
    '',
    '/balance - check balances right now',
    '/meters - list your registered meters',
    '/sms <phone> - get alerts by SMS too (paid plans)',
    '/discord <url> - get alerts in a Discord channel (free)',
    '/email <address> - sign in to the web dashboard with this chat',
    '/plan - your current plan',
    '/dashboard - balance history charts in your browser',
    '/settings - tone and quiet hours',
    '/menu - quick action buttons',
    '/stop - pause all monitoring',
    '/delete - erase your account and all data',
    '/privacy - what we store and why',
    '/help - this message',
  ].join('\n');
}

const PRIVACY_TEXT = [
  '🔒 *Privacy, the short version*',
  '',
  '*What I store:* your Telegram chat id, the account & meter numbers you register, the balance history I read for them, and any alert channel you add (e.g. a Discord webhook URL - /delete removes it).',
  '*Why:* that is literally the product - I cannot watch a balance without them.',
  '*What I never do:* sell or share your data, message anyone but you, or store DESCO credentials (there are none - balances are read with just the account/meter numbers).',
  '*Leaving:* /stop pauses all monitoring immediately. /delete erases your account and all monitoring data we hold - no questions, no email required. We retain a brief internal audit log of operator actions (e.g. a plan grant) for accountability; it carries no balance or meter data.',
  '',
  '_Power Roast is an independent project, not affiliated with DESCO._',
].join('\n');

export function createBot(
  db: Db,
  config: ServerConfig,
  subscriptions: SubscriptionService,
  smsGateway: SmsGateway | null,
  mailer: Mailer | null = null
): Bot {
  const bot = new Bot(
    config.telegramBotToken,
    config.telegramApiRoot ? { client: { apiRoot: config.telegramApiRoot } } : undefined
  );
  const pendingDeletes = new Map<number, number>(); // chatId -> confirm-by timestamp
  const pendingSms = new Map<number, PendingSmsVerification>();
  // chatId -> awaiting a typed value for a settings field (from a "Custom" button)
  const pendingInput = new Map<number, { kind: 'quiet' }>();
  const descoLookups = new RateLimiter(DESCO_LOOKUPS_PER_WINDOW, DESCO_LOOKUP_WINDOW_MS);
  const otpSends = new RateLimiter(SMS_OTP_SENDS_PER_HOUR, 60 * 60 * 1000);
  const discordTests = new RateLimiter(DISCORD_TESTS_PER_WINDOW, DISCORD_TEST_WINDOW_MS);
  const emailLinks = new RateLimiter(EMAIL_LINKS_PER_WINDOW, EMAIL_LINK_WINDOW_MS);
  // Free-only launch: paid plans are off until a real gateway is configured.
  const live = billingLive(config.billing);
  // Meters and their settings are managed on the web dashboard now; the bot
  // points here instead of registering meters itself.
  const appUrl = `${config.publicBaseUrl.replace(/\/+$/, '')}/app`;
  const HELP_TEXT = helpText(appUrl);
  // Shown wherever a chat has no linked account: sign up on the web, then connect.
  const signupPointer =
    `You don't have an account yet. Sign up (or sign in) at ${appUrl}, ` +
    'then tap "Connect Telegram" on the dashboard to link this chat. ' +
    'Already have a web account? Send /email <your address> here to connect.';

  async function findUser(chatId: number) {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.telegramChatId, chatId));
    return user ?? null;
  }

  async function userMeters(chatId: number) {
    return db
      .select({ meter: schema.meters })
      .from(schema.meters)
      .innerJoin(schema.users, eq(schema.meters.userId, schema.users.id))
      .where(and(eq(schema.users.telegramChatId, chatId), eq(schema.meters.active, true)))
      .then(rows => rows.map(r => r.meter));
  }

  function mainMenuKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
      .text('💰 Balance', 'menu:balance')
      .text('⚙️ Settings', 'menu:settings')
      .row()
      .text('📊 Dashboard', 'menu:dashboard')
      .text('🎟️ Plan', 'menu:plan');
  }

  // Handle a "/start link_<token>" deep link from the web app's Connect Telegram
  // button: link this chat to that web account, or merge if this chat already has
  // its own account.
  // Link this chat to a Discord identity (from the Discord bot's /telegram
  // command). Unlike the web flow, the token carries a Discord user id, not an
  // account id - the Discord side may not have an account yet.
  async function handleDiscordLinkPayload(ctx: Context, discordUserId: string): Promise<void> {
    if (!ctx.chat) return;
    const chatId = ctx.chat.id;
    const [discordUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordUserId, discordUserId));
    const botUser = await findUser(chatId);

    if (discordUser && botUser) {
      if (discordUser.id === botUser.id) {
        await ctx.reply("You're already linked ✅ Same account on Telegram and Discord.");
        return;
      }
      const discordHasSub = (await subscriptions.activeFor(discordUser.id)) !== null;
      const botHasSub = (await subscriptions.activeFor(botUser.id)) !== null;
      const { survivorId, loserId } = chooseSurvivor(
        { id: discordUser.id, hasSubscription: discordHasSub },
        { id: botUser.id, hasSubscription: botHasSub }
      );
      const merged = await mergeAccounts(db, survivorId, loserId);
      if (merged !== 'merged') {
        await ctx.reply(
          "That link didn't go through (one of the accounts changed in the meantime). Run /telegram in Discord again for a fresh link."
        );
        return;
      }
      await ctx.reply(
        'Linked ✅ Merged your Telegram and Discord accounts - meters, plan, and alerts are all in one place now.'
      );
      return;
    }
    if (discordUser) {
      await linkIdentity(db, discordUser.id, { provider: 'telegram', chatId });
      await ctx.reply(
        "Linked ✅ You'll get alerts here too - Telegram and Discord are the same account now."
      );
      return;
    }
    // No Discord-side account. If this chat has an account, connect Discord to
    // it and open the DM alert channel; otherwise there's nothing to attach to -
    // accounts are created on the web, not by the bots.
    if (!botUser) {
      await ctx.reply(signupPointer);
      return;
    }
    // linkIdentity writes the identity row, the legacy column, and the verified
    // discord-dm channel together, so the three can't drift apart.
    await linkIdentity(db, botUser.id, { provider: 'discord', discordUserId });
    await ctx.reply(
      'Linked ✅ Your Discord is connected - alerts and slash commands work in both apps now.'
    );
  }

  async function handleLinkPayload(ctx: Context, token: string): Promise<void> {
    if (!ctx.chat) return;
    const webUserId = verifyLinkToken(token, config.dashboardSecret);
    if (webUserId === null) {
      const discordUserId = verifyDiscordLinkToken(token, config.dashboardSecret);
      if (discordUserId !== null) {
        await handleDiscordLinkPayload(ctx, discordUserId);
        return;
      }
      await ctx.reply(
        "That connect link expired or isn't valid. Get a fresh one: Connect Telegram in the web app, or /telegram in the Discord bot."
      );
      return;
    }
    const [webUser] = await db.select().from(schema.users).where(eq(schema.users.id, webUserId));
    if (!webUser) {
      await ctx.reply(
        'That account no longer exists. Try Connect Telegram again from the web app.'
      );
      return;
    }
    const chatId = ctx.chat.id;
    const botUser = await findUser(chatId);
    if (!botUser) {
      await linkIdentity(db, webUserId, { provider: 'telegram', chatId });
      await ctx.reply(
        "Linked ✅ You'll get alerts here now - this chat and the web app are the same account."
      );
      return;
    }
    if (botUser.id === webUserId) {
      await ctx.reply("You're already linked ✅ Same account on Telegram and the web app.");
      return;
    }
    // Two separate accounts for the same person: merge them into one.
    const webHasSub = (await subscriptions.activeFor(webUserId)) !== null;
    const botHasSub = (await subscriptions.activeFor(botUser.id)) !== null;
    const { survivorId, loserId } = chooseSurvivor(
      { id: webUserId, hasSubscription: webHasSub },
      { id: botUser.id, hasSubscription: botHasSub }
    );
    const merged = await mergeAccounts(db, survivorId, loserId);
    if (merged !== 'merged') {
      await ctx.reply(
        "That link didn't go through (one of the accounts changed in the meantime). Try Connect Telegram again from the web app."
      );
      return;
    }
    await ctx.reply(
      'Linked ✅ Merged your Telegram and web accounts - your meters and plan are all in one place now.'
    );
  }

  async function settingsView(
    chatId: number
  ): Promise<{ text: string; keyboard: InlineKeyboard } | null> {
    const user = await findUser(chatId);
    if (!user) {
      return null;
    }
    const tone = normalizeTone(user.tonePref);
    const quiet =
      user.quietStart !== null && user.quietEnd !== null
        ? `${user.quietStart}:00-${user.quietEnd}:00 (Dhaka)`
        : 'off';
    const text = [
      '⚙️ *Settings*',
      '',
      `*Tone:* ${tone === 'savage' ? 'savage 🌶️' : 'mild 🥛'}`,
      `*Quiet hours:* ${quiet}`,
      '',
      `Thresholds and meter names live on your dashboard: ${appUrl}`,
      '',
      'Tap to change tone or quiet hours:',
    ].join('\n');
    const keyboard = new InlineKeyboard()
      .text(
        tone === 'savage' ? '🥛 Switch to mild' : '🌶️ Switch to savage',
        tone === 'savage' ? 'tone:mild' : 'tone:savage'
      )
      .row()
      .text('🔕 Quiet off', 'quiet:off')
      .text('🌙 10pm-7am', 'quiet:22-7')
      .text('🌙 11pm-6am', 'quiet:23-6')
      .text('✏️ Custom', 'quiet:custom');
    return { text, keyboard };
  }

  async function showSettings(ctx: Context): Promise<void> {
    if (!ctx.chat) return;
    const view = await settingsView(ctx.chat.id);
    if (!view) {
      await ctx.reply(signupPointer);
      return;
    }
    await ctx.reply(view.text, { parse_mode: 'Markdown', reply_markup: view.keyboard });
  }

  // re-render the settings message in place after a button press
  async function refreshSettings(ctx: Context): Promise<void> {
    if (!ctx.chat) return;
    const view = await settingsView(ctx.chat.id);
    if (!view) return;
    try {
      await ctx.editMessageText(view.text, {
        parse_mode: 'Markdown',
        reply_markup: view.keyboard,
      });
    } catch {
      // editing fails if the message is too old or unchanged - just send fresh
      await ctx.reply(view.text, { parse_mode: 'Markdown', reply_markup: view.keyboard });
    }
  }

  async function showBalance(ctx: Context): Promise<void> {
    if (!ctx.chat) return;
    const meters = await userMeters(ctx.chat.id);
    if (meters.length === 0) {
      await ctx.reply(`No meters yet. Add one on your dashboard: ${appUrl}`);
      return;
    }
    if (!descoLookups.allow(ctx.chat.id)) {
      await ctx.reply(
        "Easy there. You've checked enough for now - I'm not DDoSing DESCO for you. Try again in a few minutes (alerts still run on schedule)."
      );
      return;
    }
    await ctx.reply('Checking... ⏳');
    for (const meter of meters) {
      try {
        const data = await getProvider(meter.provider).getBalance({
          accountNo: meter.accountNo,
          meterNo: meter.meterNo,
        });
        await ctx.reply(
          balanceStatusMessage({
            nickname: meter.nickname,
            accountNo: meter.accountNo,
            meterNo: meter.meterNo,
            balance: data.balance,
            lowThreshold: meter.lowThreshold,
            criticalThreshold: meter.criticalThreshold,
            prediction: await recentPrediction(db, meter.id, data.balance),
          })
        );
      } catch {
        await ctx.reply(
          `Couldn't reach DESCO for meter ${meter.meterNo} right now. Try again in a bit.`
        );
      }
    }
  }

  async function showDashboard(ctx: Context): Promise<void> {
    if (!ctx.chat) return;
    const user = await findUser(ctx.chat.id);
    if (!user) {
      await ctx.reply(signupPointer);
      return;
    }
    const token = signDashboardToken(
      user.id,
      Date.now() + DASHBOARD_LINK_TTL_MS,
      config.dashboardSecret
    );
    await ctx.reply(
      [
        `Your dashboard (link valid 24h, then ask me again):`,
        `${config.publicBaseUrl}/dash?t=${token}`,
      ].join('\n')
    );
  }

  async function showPlan(ctx: Context): Promise<void> {
    if (!ctx.chat) return;
    const user = await findUser(ctx.chat.id);
    if (!user) {
      await ctx.reply(signupPointer);
      return;
    }
    const lines = [
      `Plan: *${user.plan}*`,
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
          ? 'Want SMS alerts and more meters? /upgrade'
          : 'SMS alerts and more meters are coming soon.'
      );
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  }

  bot.command('start', async ctx => {
    const payload = (ctx.match ?? '').trim();
    if (payload.startsWith('link_')) {
      await handleLinkPayload(ctx, payload.slice('link_'.length));
      return;
    }
    const user = await findUser(ctx.chat.id);
    if (!user) {
      // brand-new chat: accounts are created on the web, so send them there
      await ctx.reply(
        `Welcome to Power Roast ⚡ I watch your prepaid electricity balance and roast you before the lights go out.\n\n${signupPointer}\n\n_By adding a meter you agree to /privacy._`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    await ctx.reply(`Welcome back to Power Roast.\n\n${HELP_TEXT}`, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    });
  });

  bot.command('help', async ctx => {
    await ctx.reply(HELP_TEXT, { parse_mode: 'Markdown' });
  });

  bot.command('privacy', async ctx => {
    await ctx.reply(PRIVACY_TEXT, { parse_mode: 'Markdown' });
  });

  bot.command('menu', async ctx => {
    await ctx.reply('What do you want to do?', {
      reply_markup: mainMenuKeyboard(),
    });
  });

  bot.command('settings', async ctx => {
    await showSettings(ctx);
  });

  bot.command('register', async ctx => {
    await ctx.reply(signupPointer);
  });

  bot.command('balance', async ctx => {
    await showBalance(ctx);
  });

  bot.command('threshold', async ctx => {
    await ctx.reply(`Alert thresholds are set on your dashboard now: ${appUrl}`);
  });

  bot.command('dashboard', async ctx => {
    await showDashboard(ctx);
  });

  bot.command('plan', async ctx => {
    await showPlan(ctx);
  });

  bot.command('upgrade', async ctx => {
    const user = await findUser(ctx.chat.id);
    if (!user) {
      await ctx.reply(signupPointer);
      return;
    }
    if (!live) {
      await ctx.reply(
        "💸 Paid plans aren't switched on yet - everyone's on *free* for now (1 meter, Telegram alerts). SMS alerts and multi-meter support are coming soon; I'll announce it right here.",
        { parse_mode: 'Markdown' }
      );
      return;
    }
    const requested = (ctx.match ?? '').trim().toLowerCase();
    if (!isPurchasablePlan(requested)) {
      await ctx.reply(
        [
          '*Plans*',
          '',
          `*plus* - ৳${priceBdtFor('plus')}/month: 5 meters, ${smsPerMonthFor('plus')} SMS/month, hourly-grade attention`,
          `*business* - ৳${priceBdtFor('business')}/month: unlimited meters, ${smsPerMonthFor('business')} SMS/month, for landlords`,
          '',
          'Pick one: /upgrade plus  or  /upgrade business',
        ].join('\n'),
        { parse_mode: 'Markdown' }
      );
      return;
    }
    if (user.plan === requested) {
      await ctx.reply(`You're already on ${requested}. Generous, but no.`);
      return;
    }

    try {
      const result = await subscriptions.startUpgrade(user, requested);
      if (result.activated) {
        await ctx.reply(
          `✅ You're on *${requested}* now. SMS budget: ${smsPerMonthFor(requested)}/month. Add a phone with /sms <number>.`,
          { parse_mode: 'Markdown' }
        );
      } else if (result.paymentUrl) {
        await ctx.reply(`Complete your payment here: ${result.paymentUrl}`);
      } else {
        await ctx.reply('Payment is pending - I will confirm once it clears.');
      }
    } catch (error) {
      logger.error('Upgrade failed', error);
      await ctx.reply(
        "Couldn't reach the payment gateway just now. Give it a minute and try /upgrade again."
      );
    }
  });

  // operator-only: /grant <telegram chat id> <plan> [days]
  bot.command('grant', async ctx => {
    if (config.adminChatId === null || ctx.chat.id !== config.adminChatId) {
      return;
    }
    const [chatIdRaw, plan, daysRaw] = (ctx.match ?? '').trim().split(/\s+/);
    const targetChatId = parseInt(chatIdRaw);
    const days = daysRaw ? parseInt(daysRaw) : 30;
    if (!Number.isFinite(targetChatId) || !isPurchasablePlan(plan) || !Number.isFinite(days)) {
      await ctx.reply('Usage: /grant <telegram chat id> <plus|business> [days=30]');
      return;
    }
    const [target] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.telegramChatId, targetChatId));
    if (!target) {
      await ctx.reply(`No user with chat id ${targetChatId}.`);
      return;
    }
    await subscriptions.grant(target.id, plan, days);
    await ctx.reply(
      `Granted ${plan} to user ${target.id} (chat ${targetChatId}) for ${days} days.`
    );
  });

  bot.command('sms', async ctx => {
    const user = await findUser(ctx.chat.id);
    if (!user) {
      await ctx.reply(signupPointer);
      return;
    }
    const budget = smsPerMonthFor(user.plan);
    if (budget === 0) {
      await ctx.reply(
        'SMS alerts are a paid feature - they reach you even when the power (and your WiFi) is already gone. Unlock them with /upgrade; Telegram alerts stay free forever.'
      );
      return;
    }

    if (!smsGateway) {
      await ctx.reply(
        "SMS alerts aren't live yet - the gateway is still being set up. You'll be the first to know."
      );
      return;
    }

    const phone = normalizeBdPhone((ctx.match ?? '').trim());
    if (!phone) {
      await ctx.reply('Usage: /sms <BD mobile number> - e.g. /sms 01712345678');
      return;
    }

    const [existing] = await db
      .select()
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.userId, user.id),
          eq(schema.channels.type, 'sms'),
          eq(schema.channels.address, phone)
        )
      );
    if (existing?.verified && existing.enabled) {
      await ctx.reply(`That number already gets alerts (up to ${budget} SMS/month).`);
      return;
    }

    // prove ownership before a single alert goes out - otherwise the bot is
    // an SMS-harassment tool pointed at arbitrary numbers
    if (!otpSends.allow(ctx.chat.id)) {
      await ctx.reply('Too many verification codes requested. Try again in an hour.');
      return;
    }
    const code = crypto.randomInt(100000, 1000000).toString();
    pendingSms.set(ctx.chat.id, {
      phone,
      code,
      expiresAt: Date.now() + SMS_OTP_TTL_MS,
      attempts: 0,
    });
    try {
      await smsGateway.send(phone, `PowerRoast verification code: ${code}`);
    } catch (error) {
      pendingSms.delete(ctx.chat.id);
      logger.error('OTP send failed', error);
      await ctx.reply("Couldn't reach that number right now. Check it and try again in a bit.");
      return;
    }
    await ctx.reply(
      `Sent a code to ${phone} by SMS. Reply with the 6 digits to prove it's yours (valid 10 minutes).`
    );
  });

  bot.command('discord', async ctx => {
    const user = await findUser(ctx.chat.id);
    if (!user) {
      await ctx.reply(signupPointer);
      return;
    }

    const existing = await discordWebhook(db, user.id);

    const arg = (ctx.match ?? '').trim();
    const howTo =
      'In Discord: Server Settings > Integrations > Webhooks > New Webhook > Copy URL, then send /discord <that url>.';

    // no args: show current status
    if (!arg) {
      if (existing?.enabled) {
        await ctx.reply(
          `Discord alerts are on → ${maskWebhookUrl(existing.address)}\n/discord off to stop, or /discord <url> to point them somewhere else.`
        );
      } else if (existing) {
        await ctx.reply(
          `Discord alerts are set up but paused. Send /discord <url> to turn them back on.`
        );
      } else {
        await ctx.reply(`No Discord webhook connected yet. ${howTo}`);
      }
      return;
    }

    // /discord off: pause the channel without forgetting the URL
    if (arg.toLowerCase() === 'off') {
      if ((await disableDiscordWebhook(db, user.id)) === 'not-on') {
        await ctx.reply("Discord alerts aren't on, so there's nothing to turn off.");
        return;
      }
      await ctx.reply('Discord alerts paused. Send /discord <url> to turn them back on.');
      return;
    }

    // Reject a malformed URL before the throttle, so a typo doesn't cost the user
    // one of their test sends.
    if (!isValidDiscordWebhookUrl(arg)) {
      await ctx.reply(`That doesn't look like a Discord webhook URL. ${howTo}`);
      return;
    }
    // The test send costs Discord a request, so throttle before we make it.
    if (!discordTests.allow(ctx.chat.id)) {
      await ctx.reply('Too many Discord test sends. Give it a few minutes and try again.');
      return;
    }
    const result = await connectDiscordWebhook(db, user.id, arg);
    if (!result.ok) {
      await ctx.reply(
        result.reason === 'invalid-url'
          ? `That doesn't look like a Discord webhook URL. ${howTo}`
          : "Couldn't post to that webhook - Discord rejected it. Make sure the URL is current (webhooks can be deleted) and try again."
      );
      return;
    }
    await ctx.reply(
      "Sent a test message to your Discord ✅ If you saw it, you're all set - alerts will go there too."
    );
  });

  bot.command('email', async ctx => {
    const user = await findUser(ctx.chat.id);
    if (!user) {
      await ctx.reply(signupPointer);
      return;
    }
    if (!mailer) {
      await ctx.reply("Email sign-in isn't set up on this bot.");
      return;
    }
    const email = (ctx.match ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      await ctx.reply('Usage: /email you@example.com - links this account to the web app.');
      return;
    }
    if (!emailLinks.allow(ctx.chat.id)) {
      await ctx.reply('Too many email requests. Try again in a few minutes.');
      return;
    }
    try {
      await sendMagicLink(
        mailer,
        config.publicBaseUrl,
        email,
        signMagicLink(email, config.dashboardSecret),
        magicCode(email, config.dashboardSecret),
        signLinkToken(user.id, config.dashboardSecret)
      );
    } catch (error) {
      logger.error('Bot /email send failed', error instanceof Error ? error.message : error);
      await ctx.reply("Couldn't send that email right now. Try again in a bit.");
      return;
    }
    await ctx.reply(
      `Sent a sign-in link to ${email}. Open it to connect this account to the web app (manage meters in a browser too).`
    );
  });

  bot.command('nickname', async ctx => {
    await ctx.reply(`Rename your meters on your dashboard now: ${appUrl}`);
  });

  bot.command('meters', async ctx => {
    const meters = await userMeters(ctx.chat.id);
    if (meters.length === 0) {
      await ctx.reply(`No meters yet. Add one on your dashboard: ${appUrl}`);
      return;
    }
    const lines = meters.map(
      m =>
        `📟 ${m.nickname ?? m.meterNo} - account ${m.accountNo}, thresholds ৳${m.lowThreshold}/৳${m.criticalThreshold}`
    );
    await ctx.reply(lines.join('\n'));
  });

  bot.command('delete', async ctx => {
    const user = await findUser(ctx.chat.id);
    if (!user) {
      await ctx.reply('Nothing to delete - you have no account.');
      return;
    }
    const arg = (ctx.match ?? '').trim();
    if (arg !== 'CONFIRM') {
      pendingDeletes.set(ctx.chat.id, Date.now() + DELETE_CONFIRM_WINDOW_MS);
      await ctx.reply(
        [
          '⚠️ This permanently erases your account: meters, balance history, alerts, subscription - everything. No undo.',
          '',
          'If you mean it, send within 60 seconds:',
          '/delete CONFIRM',
        ].join('\n')
      );
      return;
    }
    const confirmBy = pendingDeletes.get(ctx.chat.id);
    if (!confirmBy || Date.now() > confirmBy) {
      await ctx.reply('That confirmation expired. Start again with /delete.');
      return;
    }
    pendingDeletes.delete(ctx.chat.id);
    await eraseUser(db, user.id);
    await ctx.reply(
      'Done. Everything is erased. It was an honor roasting you. The lights are your problem now. 🕯️'
    );
  });

  bot.command('stop', async ctx => {
    const user = await findUser(ctx.chat.id);
    if (!user) {
      await ctx.reply(STOP_NOTHING_TO_DO);
      return;
    }
    await stopMonitoring(db, user.id);
    await ctx.reply(STOP_CONFIRMED);
  });

  // operator-only metrics; silent for everyone else
  bot.command('stats', async ctx => {
    if (config.adminChatId === null || ctx.chat.id !== config.adminChatId) {
      return;
    }
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [users, activeMeters, readings, alerts24h] = await Promise.all([
      db.$count(schema.users),
      db.$count(schema.meters, eq(schema.meters.active, true)),
      db.$count(schema.readings),
      db.$count(schema.alertsLog, gte(schema.alertsLog.sentAt, dayAgo)),
    ]);
    await ctx.reply(
      [
        '📊 *Power Roast stats*',
        `Users: ${users}`,
        `Active meters: ${activeMeters}`,
        `Readings stored: ${readings}`,
        `Alerts sent (24h): ${alerts24h}`,
      ].join('\n'),
      { parse_mode: 'Markdown' }
    );
  });

  // ---- inline button callbacks ----

  bot.callbackQuery('menu:balance', async ctx => {
    await ctx.answerCallbackQuery();
    await showBalance(ctx);
  });
  bot.callbackQuery('menu:settings', async ctx => {
    await ctx.answerCallbackQuery();
    await showSettings(ctx);
  });
  bot.callbackQuery('menu:dashboard', async ctx => {
    await ctx.answerCallbackQuery();
    await showDashboard(ctx);
  });
  bot.callbackQuery('menu:plan', async ctx => {
    await ctx.answerCallbackQuery();
    await showPlan(ctx);
  });

  bot.callbackQuery(/^tone:(savage|mild)$/, async ctx => {
    if (!ctx.chat) return;
    const user = await findUser(ctx.chat.id);
    if (!user) {
      await ctx.answerCallbackQuery('Register a meter first.');
      return;
    }
    const tone = normalizeTone(ctx.match[1]);
    await setTone(db, user.id, tone);
    await ctx.answerCallbackQuery(`Tone set to ${tone}.`);
    await refreshSettings(ctx);
  });

  bot.callbackQuery('quiet:custom', async ctx => {
    if (!ctx.chat) return;
    pendingInput.set(ctx.chat.id, { kind: 'quiet' });
    await ctx.answerCallbackQuery();
    await ctx.reply(
      'Send your quiet hours as two numbers (24h, Dhaka time): start then end, e.g. `22 7` for 10pm-7am. Or send `off`.',
      { parse_mode: 'Markdown' }
    );
  });
  bot.callbackQuery(/^quiet:(off|\d{1,2}-\d{1,2})$/, async ctx => {
    if (!ctx.chat) return;
    const user = await findUser(ctx.chat.id);
    if (!user) {
      await ctx.answerCallbackQuery('Register a meter first.');
      return;
    }
    const spec = ctx.match[1];
    let quietStart: number | null = null;
    let quietEnd: number | null = null;
    if (spec !== 'off') {
      const [s, e] = spec.split('-').map(Number);
      quietStart = s;
      quietEnd = e;
    }
    await db.update(schema.users).set({ quietStart, quietEnd }).where(eq(schema.users.id, user.id));
    await ctx.answerCallbackQuery(spec === 'off' ? 'Quiet hours off.' : 'Quiet hours set.');
    await refreshSettings(ctx);
  });

  bot.callbackQuery(/^snooze:(\d+)$/, async ctx => {
    if (!ctx.chat) return;
    const user = await findUser(ctx.chat.id);
    if (!user) {
      await ctx.answerCallbackQuery('Register a meter first.');
      return;
    }
    const meterId = Number(ctx.match[1]);
    const [meter] = await db
      .select()
      .from(schema.meters)
      .where(and(eq(schema.meters.id, meterId), eq(schema.meters.userId, user.id)));
    if (!meter) {
      await ctx.answerCallbackQuery('That meter is not yours.');
      return;
    }
    const until = new Date(Date.now() + SNOOZE_MS);
    await db
      .insert(schema.alertState)
      .values({ meterId, remindersSnoozedUntil: until })
      .onConflictDoUpdate({
        target: schema.alertState.meterId,
        set: { remindersSnoozedUntil: until, updatedAt: new Date() },
      });
    await ctx.answerCallbackQuery("Snoozed reminders for 3 days. I'll still shout if it recovers.");
  });

  // "Check again" on an alert: re-poll DESCO for that meter on demand.
  bot.callbackQuery(/^recheck:(\d+)$/, async ctx => {
    if (!ctx.chat) return;
    const user = await findUser(ctx.chat.id);
    if (!user) {
      await ctx.answerCallbackQuery('Register a meter first.');
      return;
    }
    const meterId = Number(ctx.match[1]);
    const [meter] = await db
      .select()
      .from(schema.meters)
      .where(and(eq(schema.meters.id, meterId), eq(schema.meters.userId, user.id)));
    if (!meter) {
      await ctx.answerCallbackQuery('That meter is not yours.');
      return;
    }
    if (!descoLookups.allow(ctx.chat.id)) {
      await ctx.answerCallbackQuery(
        "You've checked plenty - give DESCO a breather and try again in a few minutes."
      );
      return;
    }
    await ctx.answerCallbackQuery('Checking...');
    const tone = normalizeTone(user.tonePref);
    const label = meter.nickname ?? `meter ${meter.meterNo}`;
    try {
      const data = await getProvider(meter.provider).getBalance({
        accountNo: meter.accountNo,
        meterNo: meter.meterNo,
      });
      const bal = data.balance;
      if (bal >= meter.lowThreshold) {
        await ctx.reply(
          tone === 'mild'
            ? `${label}: ৳${bal.toFixed(2)} now - you're back in the clear.`
            : `৳${bal.toFixed(2)} now - crisis averted 👏 ${label} lives to bill another day.`
        );
      } else {
        const stillCritical = bal < meter.criticalThreshold;
        await ctx.reply(
          tone === 'mild'
            ? `${label}: still ${stillCritical ? 'critically ' : ''}low at ৳${bal.toFixed(2)}. Worth a top-up.`
            : `Still ৳${bal.toFixed(2)} on ${label}${stillCritical ? ' - DEFCON 1' : ''}. The meter didn't recharge itself while you tapped a button. Shocking.`
        );
      }
    } catch (error) {
      await ctx.reply(
        error instanceof ProviderUnavailableError
          ? "DESCO isn't answering right now - try again in a few minutes."
          : `Couldn't read ${label} just now. Try again in a bit.`
      );
    }
  });

  // plain text drives the registration conversation
  bot.on('message:text', async ctx => {
    // a value typed in after tapping a "Custom" button in /settings
    const inputState = pendingInput.get(ctx.chat.id);
    if (inputState) {
      pendingInput.delete(ctx.chat.id);
      const user = await findUser(ctx.chat.id);
      if (!user) {
        await ctx.reply(signupPointer);
        return;
      }
      // Only quiet-hours input reaches here now - thresholds moved to the dashboard.
      const raw = ctx.message.text.trim();
      if (/^off$/i.test(raw)) {
        await db
          .update(schema.users)
          .set({ quietStart: null, quietEnd: null })
          .where(eq(schema.users.id, user.id));
        await ctx.reply('Quiet hours off.');
        return;
      }
      const [s, e] = raw.split(/\s+/).map(Number);
      if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || s > 23 || e < 0 || e > 23) {
        await ctx.reply('Send two hours between 0 and 23, like `22 7` - or `off`.', {
          parse_mode: 'Markdown',
        });
        return;
      }
      await db
        .update(schema.users)
        .set({ quietStart: s, quietEnd: e })
        .where(eq(schema.users.id, user.id));
      await ctx.reply(
        `Quiet hours set: ${s}:00-${e}:00 (Dhaka). I'll hold non-critical alerts until then.`
      );
      return;
    }

    // SMS verification codes (only when not mid-registration, where a
    // 6-digit account number would be ambiguous)
    const smsState = pendingSms.get(ctx.chat.id);
    if (smsState && /^\d{6}$/.test(ctx.message.text.trim())) {
      if (Date.now() > smsState.expiresAt) {
        pendingSms.delete(ctx.chat.id);
        await ctx.reply('That code expired. Start again with /sms <number>.');
        return;
      }
      if (ctx.message.text.trim() !== smsState.code) {
        smsState.attempts++;
        if (smsState.attempts >= SMS_OTP_MAX_ATTEMPTS) {
          pendingSms.delete(ctx.chat.id);
          await ctx.reply('Too many wrong codes. Start again with /sms <number>.');
        } else {
          await ctx.reply('Nope, that is not it. Try again.');
        }
        return;
      }
      pendingSms.delete(ctx.chat.id);
      const user = await findUser(ctx.chat.id);
      if (!user) {
        await ctx.reply(signupPointer);
        return;
      }
      const [channel] = await db
        .select()
        .from(schema.channels)
        .where(
          and(
            eq(schema.channels.userId, user.id),
            eq(schema.channels.type, 'sms'),
            eq(schema.channels.address, smsState.phone)
          )
        );
      if (channel) {
        await db
          .update(schema.channels)
          .set({ verified: true, enabled: true })
          .where(eq(schema.channels.id, channel.id));
      } else {
        await db.insert(schema.channels).values({
          userId: user.id,
          type: 'sms',
          address: smsState.phone,
          verified: true,
        });
      }
      await ctx.reply(
        `✅ Verified. Low/critical alerts will also hit ${smsState.phone} - even when your WiFi is already dead.`
      );
      return;
    }

    // Meters are added on the web dashboard now, so free-form text isn't a
    // registration step anymore - point at help.
    await ctx.reply(`Not sure what you mean.\n\n${HELP_TEXT}`, { parse_mode: 'Markdown' });
  });

  return bot;
}
