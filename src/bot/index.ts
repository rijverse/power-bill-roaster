import { Bot } from 'grammy';
import { eq, and } from 'drizzle-orm';
import { Db, schema } from '../db';
import { getProvider } from '../providers';
import { ServerConfig } from '../config';
import { balanceStatusMessage } from '../notifications/telegram-templates';

interface PendingRegistration {
  step: 'account' | 'meter';
  accountNo?: string;
}

const HELP_TEXT = [
  '⚡ *Power Roast* - your brutally honest prepaid balance watchdog.',
  '',
  '/register - add your DESCO meter',
  '/balance - check balances right now',
  '/threshold <low> <critical> - set alert levels (e.g. /threshold 200 100)',
  '/meters - list your registered meters',
  '/stop - pause all monitoring',
  '/help - this message',
].join('\n');

export function createBot(db: Db, config: ServerConfig): Bot {
  const bot = new Bot(config.telegramBotToken);
  const pending = new Map<number, PendingRegistration>();

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
      `Welcome to Power Roast. I watch your prepaid electricity balance and roast you before the lights go out.\n\n${HELP_TEXT}`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('help', async ctx => {
    await ctx.reply(HELP_TEXT, { parse_mode: 'Markdown' });
  });

  bot.command('register', async ctx => {
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
    await ctx.reply('Checking… ⏳');
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
