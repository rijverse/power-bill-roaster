import { Bot, InlineKeyboard, Context } from 'grammy';
import { eq, and, gte } from 'drizzle-orm';
import { Db, schema } from '../db';
import { getProvider, ProviderUnavailableError } from '../providers';
import { ServerConfig } from '../config';
import { balanceStatusMessage } from '../notifications/telegram-templates';
import { RateLimiter } from '../core/rate-limiter';
import { maxMetersFor, smsPerMonthFor, priceBdtFor, isPurchasablePlan } from '../core/plans';
import { predictRunOut } from '../core/prediction';
import { normalizeBdPhone } from '../core/phone';
import { SubscriptionService } from '../billing';
import { signDashboardToken } from '../web/token';
import { eraseUser } from '../core/erase-user';
import { sanitizeNickname } from '../core/sanitize';
import { normalizeTone } from '../core/tone';
import { SmsGateway } from '../notifications/sms';
import crypto from 'crypto';

const DASHBOARD_LINK_TTL_MS = 24 * 60 * 60 * 1000;
const DELETE_CONFIRM_WINDOW_MS = 60 * 1000;
// how long an alert-button "snooze" mutes reminders for that meter
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

const PREDICTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NICKNAME_LENGTH = 30;

interface PendingRegistration {
  step: 'account' | 'meter';
  accountNo?: string;
}

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

const HELP_TEXT = [
  '⚡ *Power Roast* - your brutally honest prepaid balance watchdog.',
  '',
  '/register - add your DESCO meter',
  '/balance - check balances right now',
  '/threshold <low> <critical> - set alert levels (e.g. /threshold 200 100)',
  '/nickname <name> - name your meter (e.g. "Flat 3B")',
  '/sms <phone> - get alerts by SMS too (paid plans)',
  '/plan - your current plan',
  '/upgrade - more meters, SMS alerts',
  '/dashboard - balance history charts in your browser',
  '/settings - tone, quiet hours, thresholds',
  '/menu - quick action buttons',
  '/meters - list your registered meters',
  '/stop - pause all monitoring',
  '/delete - erase your account and all data',
  '/privacy - what we store and why',
  '/help - this message',
].join('\n');

const PRIVACY_TEXT = [
  '🔒 *Privacy, the short version*',
  '',
  '*What I store:* your Telegram chat id, the account & meter numbers you register, and the balance history I read for them.',
  '*Why:* that is literally the product - I cannot watch a balance without them.',
  '*What I never do:* sell or share your data, message anyone but you, or store DESCO credentials (there are none - balances are read with just the account/meter numbers).',
  '*Leaving:* /stop pauses all monitoring immediately. /delete erases your account and every byte of your data - no questions, no email required.',
  '',
  '_Power Roast is an independent project, not affiliated with DESCO._',
].join('\n');

export function createBot(
  db: Db,
  config: ServerConfig,
  subscriptions: SubscriptionService,
  smsGateway: SmsGateway | null
): Bot {
  const bot = new Bot(
    config.telegramBotToken,
    config.telegramApiRoot ? { client: { apiRoot: config.telegramApiRoot } } : undefined
  );
  const pending = new Map<number, PendingRegistration>();
  const pendingDeletes = new Map<number, number>(); // chatId -> confirm-by timestamp
  const pendingSms = new Map<number, PendingSmsVerification>();
  // chatId -> awaiting a typed value for a settings field (from a "Custom" button)
  const pendingInput = new Map<number, { kind: 'quiet' | 'threshold' }>();
  const descoLookups = new RateLimiter(DESCO_LOOKUPS_PER_WINDOW, DESCO_LOOKUP_WINDOW_MS);
  const otpSends = new RateLimiter(SMS_OTP_SENDS_PER_HOUR, 60 * 60 * 1000);
  // Free-only launch: paid plans are off until a real gateway is configured.
  const billingLive = config.billing.provider !== 'none';

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

  // Apply thresholds to every meter the user has (the bot keeps them in sync,
  // mirroring the /threshold command). Returns how many meters were updated.
  async function applyThresholds(chatId: number, low: number, critical: number): Promise<number> {
    const meters = await userMeters(chatId);
    for (const meter of meters) {
      await db
        .update(schema.meters)
        .set({ lowThreshold: low, criticalThreshold: critical })
        .where(eq(schema.meters.id, meter.id));
    }
    return meters.length;
  }

  async function settingsView(
    chatId: number
  ): Promise<{ text: string; keyboard: InlineKeyboard } | null> {
    const user = await findUser(chatId);
    if (!user) {
      return null;
    }
    const meters = await userMeters(chatId);
    const tone = normalizeTone(user.tonePref);
    const quiet =
      user.quietStart !== null && user.quietEnd !== null
        ? `${user.quietStart}:00–${user.quietEnd}:00 (Dhaka)`
        : 'off';
    const thresholds = meters[0]
      ? `৳${meters[0].lowThreshold} / ৳${meters[0].criticalThreshold}`
      : 'set after you /register a meter';
    const text = [
      '⚙️ *Settings*',
      '',
      `*Tone:* ${tone === 'savage' ? 'savage 🌶️' : 'mild 🥛'}`,
      `*Quiet hours:* ${quiet}`,
      `*Thresholds (warn / critical):* ${thresholds}`,
      '',
      'Tap to change anything:',
    ].join('\n');
    const keyboard = new InlineKeyboard()
      .text(
        tone === 'savage' ? '🥛 Switch to mild' : '🌶️ Switch to savage',
        tone === 'savage' ? 'tone:mild' : 'tone:savage'
      )
      .row()
      .text('🔕 Quiet off', 'quiet:off')
      .text('🌙 10pm–7am', 'quiet:22-7')
      .text('🌙 11pm–6am', 'quiet:23-6')
      .text('✏️ Custom', 'quiet:custom')
      .row()
      .text('⚖️ 150/100', 'thr:150-100')
      .text('⚖️ 200/120', 'thr:200-120')
      .text('✏️ Custom', 'thr:custom');
    return { text, keyboard };
  }

  async function showSettings(ctx: Context): Promise<void> {
    if (!ctx.chat) return;
    const view = await settingsView(ctx.chat.id);
    if (!view) {
      await ctx.reply('No account yet - /register a meter first.');
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
      await ctx.reply('No meters registered yet. Use /register to add one.');
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
        const recentReadings = await db
          .select({ balance: schema.readings.balance, fetchedAt: schema.readings.fetchedAt })
          .from(schema.readings)
          .where(
            and(
              eq(schema.readings.meterId, meter.id),
              gte(schema.readings.fetchedAt, new Date(Date.now() - PREDICTION_WINDOW_MS))
            )
          );
        await ctx.reply(
          balanceStatusMessage({
            nickname: meter.nickname,
            accountNo: meter.accountNo,
            meterNo: meter.meterNo,
            balance: data.balance,
            lowThreshold: meter.lowThreshold,
            criticalThreshold: meter.criticalThreshold,
            prediction: predictRunOut(
              recentReadings.map(r => ({ balance: r.balance, at: r.fetchedAt })),
              data.balance
            ),
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
      await ctx.reply('No account yet - /register a meter first.');
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
      await ctx.reply('No account yet - /register a meter first.');
      return;
    }
    const lines = [
      `Plan: *${user.plan}*`,
      `Meters: up to ${maxMetersFor(user.plan)}`,
      `SMS budget: ${smsPerMonthFor(user.plan)}/month`,
    ];
    const subscription = await subscriptions.activeFor(user.id);
    if (subscription?.currentPeriodEnd) {
      lines.push(`Renews/expires: ${subscription.currentPeriodEnd.toDateString()}`);
    }
    if (user.plan === 'free') {
      lines.push(
        '',
        billingLive
          ? 'Want SMS alerts and more meters? /upgrade'
          : 'SMS alerts and more meters are coming soon.'
      );
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  }

  bot.command('start', async ctx => {
    await ctx.reply(
      `Welcome to Power Roast. I watch your prepaid electricity balance and roast you before the lights go out.\n\n${HELP_TEXT}\n\n_By registering a meter you agree to /privacy._`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
    );
  });

  bot.command('help', async ctx => {
    await ctx.reply(HELP_TEXT, { parse_mode: 'Markdown' });
  });

  bot.command('privacy', async ctx => {
    await ctx.reply(PRIVACY_TEXT, { parse_mode: 'Markdown' });
  });

  bot.command('menu', async ctx => {
    await ctx.reply('What do you want to do?', { reply_markup: mainMenuKeyboard() });
  });

  bot.command('settings', async ctx => {
    await showSettings(ctx);
  });

  bot.command('register', async ctx => {
    const user = await findUser(ctx.chat.id);
    const meters = await userMeters(ctx.chat.id);
    const limit = maxMetersFor(user?.plan ?? 'free');
    if (meters.length >= limit) {
      await ctx.reply(
        `The free plan watches ${limit} meter - and you're already using it. Multi-meter support is coming with paid plans. (/stop frees the slot if you want to switch meters.)`
      );
      return;
    }
    pending.set(ctx.chat.id, { step: 'account' });
    await ctx.reply(
      "Send me your DESCO *account number* (it's on your bill or the DESCO portal).",
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('balance', async ctx => {
    await showBalance(ctx);
  });

  bot.command('threshold', async ctx => {
    const parts = (ctx.match ?? '').trim().split(/\s+/).filter(Boolean);
    const low = parseInt(parts[0]);
    const critical = parseInt(parts[1]);
    if (!Number.isFinite(low) || !Number.isFinite(critical) || critical >= low || critical < 0) {
      await ctx.reply(
        'Usage: /threshold <low> <critical> - e.g. /threshold 200 100 (critical must be below low).'
      );
      return;
    }
    const count = await applyThresholds(ctx.chat.id, low, critical);
    if (count === 0) {
      await ctx.reply('No meters registered yet. Use /register to add one.');
      return;
    }
    await ctx.reply(`Done. I'll warn you under ৳${low} and lose my mind under ৳${critical}.`);
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
      await ctx.reply('No account yet - /register a meter first.');
      return;
    }
    if (!billingLive) {
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
      console.error('Upgrade failed:', error);
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
      await ctx.reply('Register a meter first with /register.');
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
      console.error('OTP send failed:', error);
      await ctx.reply("Couldn't reach that number right now. Check it and try again in a bit.");
      return;
    }
    await ctx.reply(
      `Sent a code to ${phone} by SMS. Reply with the 6 digits to prove it's yours (valid 10 minutes).`
    );
  });

  bot.command('nickname', async ctx => {
    const args = (ctx.match ?? '').trim();
    const meters = await userMeters(ctx.chat.id);
    if (meters.length === 0) {
      await ctx.reply('No meters registered yet. Use /register to add one.');
      return;
    }
    if (!args) {
      await ctx.reply(
        'Usage: /nickname <name> - e.g. /nickname Flat 3B' +
          (meters.length > 1 ? '\nWith multiple meters: /nickname <meterNo> <name>' : '')
      );
      return;
    }

    const tokens = args.split(/\s+/);
    const byMeterNo = meters.find(m => m.meterNo === tokens[0]);
    let target = meters[0];
    let name = args;
    if (byMeterNo && tokens.length > 1) {
      target = byMeterNo;
      name = tokens.slice(1).join(' ');
    } else if (meters.length > 1) {
      await ctx.reply('You have multiple meters - use /nickname <meterNo> <name>.');
      return;
    }

    name = sanitizeNickname(name);
    if (!name) {
      await ctx.reply(
        'After removing the fancy characters there was nothing left. Letters and numbers, please.'
      );
      return;
    }
    if (name.length > MAX_NICKNAME_LENGTH) {
      await ctx.reply(
        `That's a novel, not a nickname. Keep it under ${MAX_NICKNAME_LENGTH} characters.`
      );
      return;
    }

    await db.update(schema.meters).set({ nickname: name }).where(eq(schema.meters.id, target.id));
    await ctx.reply(`Done. Meter ${target.meterNo} now answers to "${name}".`);
  });

  bot.command('meters', async ctx => {
    const meters = await userMeters(ctx.chat.id);
    if (meters.length === 0) {
      await ctx.reply('No meters registered yet. Use /register to add one.');
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
    pending.delete(ctx.chat.id);
    await eraseUser(db, user.id);
    await ctx.reply(
      'Done. Everything is erased. It was an honor roasting you. The lights are your problem now. 🕯️'
    );
  });

  bot.command('stop', async ctx => {
    const user = await findUser(ctx.chat.id);
    if (!user) {
      await ctx.reply('Nothing to stop - you have no registered meters.');
      return;
    }
    await db.update(schema.meters).set({ active: false }).where(eq(schema.meters.userId, user.id));
    pending.delete(ctx.chat.id);
    await ctx.reply(
      'Monitoring paused for all your meters. Use /register to start again. Good luck out there. 🕯️'
    );
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
    const tone = ctx.match[1];
    await db.update(schema.users).set({ tonePref: tone }).where(eq(schema.users.id, user.id));
    await ctx.answerCallbackQuery(`Tone set to ${tone}.`);
    await refreshSettings(ctx);
  });

  bot.callbackQuery('quiet:custom', async ctx => {
    if (!ctx.chat) return;
    pendingInput.set(ctx.chat.id, { kind: 'quiet' });
    await ctx.answerCallbackQuery();
    await ctx.reply(
      'Send your quiet hours as two numbers (24h, Dhaka time): start then end, e.g. `22 7` for 10pm–7am. Or send `off`.',
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

  bot.callbackQuery('thr:custom', async ctx => {
    if (!ctx.chat) return;
    pendingInput.set(ctx.chat.id, { kind: 'threshold' });
    await ctx.answerCallbackQuery();
    await ctx.reply('Send two numbers: warning then critical (critical lower), e.g. `200 100`.', {
      parse_mode: 'Markdown',
    });
  });
  bot.callbackQuery(/^thr:(\d+)-(\d+)$/, async ctx => {
    if (!ctx.chat) return;
    const low = Number(ctx.match[1]);
    const critical = Number(ctx.match[2]);
    const count = await applyThresholds(ctx.chat.id, low, critical);
    await ctx.answerCallbackQuery(count === 0 ? 'Register a meter first.' : 'Thresholds updated.');
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

  // plain text drives the registration conversation
  bot.on('message:text', async ctx => {
    // a value typed in after tapping a "Custom" button in /settings
    const inputState = pendingInput.get(ctx.chat.id);
    if (inputState) {
      pendingInput.delete(ctx.chat.id);
      const user = await findUser(ctx.chat.id);
      if (!user) {
        await ctx.reply('No account yet - /register a meter first.');
        return;
      }
      const raw = ctx.message.text.trim();
      if (inputState.kind === 'quiet') {
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
          `Quiet hours set: ${s}:00–${e}:00 (Dhaka). I'll hold non-critical alerts until then.`
        );
        return;
      }
      const [low, critical] = raw.split(/\s+/).map(Number);
      if (!Number.isFinite(low) || !Number.isFinite(critical) || critical >= low || critical < 0) {
        await ctx.reply('Send warning then critical (critical lower), like `200 100`.', {
          parse_mode: 'Markdown',
        });
        return;
      }
      const count = await applyThresholds(ctx.chat.id, low, critical);
      await ctx.reply(
        count > 0
          ? `Done. I'll warn you under ৳${low} and panic under ৳${critical}.`
          : 'No meters registered yet. Use /register to add one.'
      );
      return;
    }

    // SMS verification codes (only when not mid-registration, where a
    // 6-digit account number would be ambiguous)
    const smsState = pendingSms.get(ctx.chat.id);
    if (smsState && !pending.has(ctx.chat.id) && /^\d{6}$/.test(ctx.message.text.trim())) {
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
        await ctx.reply('Account vanished mid-verification. /register first.');
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

    const state = pending.get(ctx.chat.id);
    if (!state) {
      await ctx.reply(`Not sure what you mean.\n\n${HELP_TEXT}`, {
        parse_mode: 'Markdown',
      });
      return;
    }

    const input = ctx.message.text.trim();
    if (!/^\d{5,20}$/.test(input)) {
      await ctx.reply("That doesn't look like a number. Digits only, please.");
      return;
    }

    if (state.step === 'account') {
      pending.set(ctx.chat.id, { step: 'meter', accountNo: input });
      await ctx.reply('Got it. Now send your *meter number*.', { parse_mode: 'Markdown' });
      return;
    }

    // step === 'meter' validate against the live api before saving
    if (!descoLookups.allow(ctx.chat.id)) {
      // keep the pending state so they only re-send the meter number, not restart
      await ctx.reply(
        'Too many lookups right now. Wait a few minutes, then send the meter number again.'
      );
      return;
    }
    const accountNo = state.accountNo!;
    const meterNo = input;
    await ctx.reply('Verifying with DESCO... ⏳');

    let balance: number;
    try {
      const data = await getProvider('desco').getBalance({ accountNo, meterNo });
      balance = data.balance;
    } catch (error) {
      // keep the account number so they only re-enter the meter, and word the
      // error honestly - DESCO being down is not the user's fault.
      pending.set(ctx.chat.id, { step: 'meter', accountNo });
      if (error instanceof ProviderUnavailableError) {
        await ctx.reply(
          "DESCO's service isn't responding right now - your numbers may be fine. Send the meter number again in a few minutes, or /register to start over."
        );
      } else {
        await ctx.reply(
          "DESCO didn't recognize that meter number for this account. Double-check it and send the meter number again, or /register to start over."
        );
      }
      return;
    }

    let user = await findUser(ctx.chat.id);
    if (!user) {
      [user] = await db.insert(schema.users).values({ telegramChatId: ctx.chat.id }).returning();
      await db.insert(schema.channels).values({
        userId: user.id,
        type: 'telegram',
        address: String(ctx.chat.id),
        verified: true,
      });
    }

    const [existing] = await db
      .select()
      .from(schema.meters)
      .where(
        and(
          eq(schema.meters.userId, user.id),
          eq(schema.meters.accountNo, accountNo),
          eq(schema.meters.meterNo, meterNo)
        )
      );

    if (existing) {
      await db.update(schema.meters).set({ active: true }).where(eq(schema.meters.id, existing.id));
    } else {
      await db.insert(schema.meters).values({
        userId: user.id,
        provider: 'desco',
        accountNo,
        meterNo,
        lowThreshold: config.defaultThresholds.low,
        criticalThreshold: config.defaultThresholds.critical,
      });
    }

    pending.delete(ctx.chat.id);
    await ctx.reply(
      [
        `✅ Registered! Current balance: ৳${balance.toFixed(2)}.`,
        '',
        `I'll check every ${config.pollIntervalHours} hours and roast you below ৳${config.defaultThresholds.low} (full meltdown below ৳${config.defaultThresholds.critical}).`,
        'Tune with /threshold <low> <critical>.',
      ].join('\n')
    );
  });

  return bot;
}
