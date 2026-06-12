import { Bot } from 'grammy';
import { eq, and, gte } from 'drizzle-orm';
import { Db, schema } from '../db';
import { getProvider } from '../providers';
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

const DASHBOARD_LINK_TTL_MS = 24 * 60 * 60 * 1000;
const DELETE_CONFIRM_WINDOW_MS = 60 * 1000;

const PREDICTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NICKNAME_LENGTH = 30;

interface PendingRegistration {
  step: 'account' | 'meter';
  accountNo?: string;
}

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

export function createBot(db: Db, config: ServerConfig, subscriptions: SubscriptionService): Bot {
  const bot = new Bot(
    config.telegramBotToken,
    config.telegramApiRoot ? { client: { apiRoot: config.telegramApiRoot } } : undefined
  );
  const pending = new Map<number, PendingRegistration>();
  const pendingDeletes = new Map<number, number>(); // chatId -> confirm-by timestamp
  const descoLookups = new RateLimiter(DESCO_LOOKUPS_PER_WINDOW, DESCO_LOOKUP_WINDOW_MS);

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

  bot.command('start', async ctx => {
    await ctx.reply(
      `Welcome to Power Roast. I watch your prepaid electricity balance and roast you before the lights go out.\n\n${HELP_TEXT}\n\n_By registering a meter you agree to /privacy._`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('help', async ctx => {
    await ctx.reply(HELP_TEXT, { parse_mode: 'Markdown' });
  });

  bot.command('privacy', async ctx => {
    await ctx.reply(PRIVACY_TEXT, { parse_mode: 'Markdown' });
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
    await ctx.reply('Checking… ⏳');
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
    const meters = await userMeters(ctx.chat.id);
    if (meters.length === 0) {
      await ctx.reply('No meters registered yet. Use /register to add one.');
      return;
    }
    for (const meter of meters) {
      await db
        .update(schema.meters)
        .set({ lowThreshold: low, criticalThreshold: critical })
        .where(eq(schema.meters.id, meter.id));
    }
    await ctx.reply(`Done. I'll warn you under ৳${low} and lose my mind under ৳${critical}.`);
  });

  bot.command('dashboard', async ctx => {
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
  });

  bot.command('plan', async ctx => {
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
      lines.push('', 'Want SMS alerts and more meters? /upgrade');
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  });

  bot.command('upgrade', async ctx => {
    const user = await findUser(ctx.chat.id);
    if (!user) {
      await ctx.reply('No account yet - /register a meter first.');
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
        'Payments are not live yet - real billing is around the corner. Watch this space.'
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
        'SMS alerts are a paid feature - they reach you even when the power (and your WiFi) is already gone. Paid plans are coming soon; Telegram alerts stay free forever.'
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
    if (existing) {
      await db
        .update(schema.channels)
        .set({ enabled: true })
        .where(eq(schema.channels.id, existing.id));
    } else {
      await db.insert(schema.channels).values({
        userId: user.id,
        type: 'sms',
        address: phone,
        verified: false,
      });
    }
    await ctx.reply(
      `Done. Low/critical alerts will also go to ${phone} (up to ${budget} SMS/month on your plan).`
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

  // plain text drives the registration conversation
  bot.on('message:text', async ctx => {
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
      pending.delete(ctx.chat.id);
      await ctx.reply('Too many verification attempts. Wait a few minutes and /register again.');
      return;
    }
    const accountNo = state.accountNo!;
    const meterNo = input;
    await ctx.reply('Verifying with DESCO… ⏳');

    let balance: number;
    try {
      const data = await getProvider('desco').getBalance({ accountNo, meterNo });
      balance = data.balance;
    } catch {
      await ctx.reply(
        "DESCO doesn't recognize that account/meter combo (or their API is down). Double-check the numbers and /register again."
      );
      pending.delete(ctx.chat.id);
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
