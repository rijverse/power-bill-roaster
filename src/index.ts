import { getServerConfig } from './config';
import { createDb } from './db';
import { createBot } from './bot';
import { Scheduler } from './core/scheduler';
import { Dispatcher, AlertButton, DiscordDmSender } from './notifications/dispatcher';
import { AlertDispatcherWorker } from './core/alert-dispatcher';
import { createSmsGateway } from './notifications/sms';
import { createMailer } from './services/mailer';
import { createPaymentProvider, SubscriptionService } from './billing';
import { createWebServer } from './web/server';
import { DiscordApi } from './discord/api';
import { createDiscordBot } from './discord/bot';
import { DISCORD_COMMANDS } from './discord/command-defs';
import { discordPublicKey } from './discord/verify';
import { DiscordInteractionDeps } from './discord/interactions';
import { logger } from './logger';
import { InlineKeyboard } from 'grammy';

// Translate the dispatcher's channel-agnostic button spec into a grammy keyboard.
function buildKeyboard(rows: AlertButton[][]): InlineKeyboard {
  const kb = new InlineKeyboard();
  rows.forEach((row, i) => {
    if (i > 0) kb.row();
    for (const button of row) {
      if ('url' in button) {
        kb.url(button.text, button.url);
      } else {
        kb.text(button.text, button.callbackData);
      }
    }
  });
  return kb;
}

async function main(): Promise<void> {
  const config = getServerConfig();
  const { db, pool } = createDb(config.databaseUrl);

  const smsGateway = createSmsGateway(config);
  if (smsGateway) {
    logger.info(`SMS channel enabled via ${smsGateway.name} gateway`);
  }
  const mailer = createMailer(config);
  if (mailer) {
    logger.info(`Email channel enabled (from ${mailer.from})`);
  }
  const subscriptions = new SubscriptionService(db, createPaymentProvider(config));
  const bot = createBot(db, config, subscriptions, smsGateway, mailer);
  const telegramSender = {
    sendTelegram: async (chatId: number, text: string, buttons?: AlertButton[][]) => {
      await bot.api.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: buttons ? buildKeyboard(buttons) : undefined,
      });
    },
  };
  subscriptions.notifyDowngrade = async (chatId, expiredPlan, pausedMeters) => {
    const pausedNote =
      pausedMeters > 0
        ? ` I paused ${pausedMeters} meter(s) beyond the free limit - /upgrade, then /register them again to wake them up.`
        : '';
    await telegramSender.sendTelegram(
      chatId,
      `⏳ Your ${expiredPlan} plan expired, so you're back on free.${pausedNote}`
    );
  };
  subscriptions.notifyUpgrade = async (chatId, plan) => {
    await telegramSender.sendTelegram(
      chatId,
      `✅ Payment confirmed - you're on *${plan}* now. Add a phone for SMS alerts with /sms <number>.`
    );
  };

  // Discord bot: slash commands land on /discord/interactions, alerts go out
  // as DMs. Everything stays null when the DISCORD_* vars aren't set.
  let discordInteractions: DiscordInteractionDeps | null = null;
  let discordApi: DiscordApi | null = null;
  let discordDm: DiscordDmSender | null = null;
  if (config.discord) {
    const api = new DiscordApi(config.discord.botToken, config.discord.apiBaseUrl ?? undefined);
    discordApi = api;
    // one DM route shared by alert dispatch and the bot's register-time test
    discordDm = { sendDm: (userId, embed) => api.sendDm(userId, { embeds: [embed] }) };
    discordInteractions = {
      bot: createDiscordBot(db, config, subscriptions, discordDm),
      api,
      appId: config.discord.appId,
      publicKey: discordPublicKey(config.discord.publicKey),
    };
    logger.info('Discord bot enabled (POST /discord/interactions)');
  }

  const dispatcher = new Dispatcher(db, telegramSender, smsGateway, mailer, discordDm);
  // outbox drain worker - flips rows to 'sent' / 'failed' and pings admin on
  // dead letters. owns dispatch end-to-end.
  const alertWorker = new AlertDispatcherWorker({
    db,
    dispatcher,
    adminSender: telegramSender,
    adminChatId: config.adminChatId,
  });
  const scheduler = new Scheduler(db, pool, telegramSender, config, subscriptions);

  const healthServer = createWebServer(
    db,
    scheduler,
    config,
    subscriptions,
    mailer,
    discordInteractions
  );
  healthServer.listen(config.port, () => {
    logger.info(`Web server on :${config.port} (/health, /dash, /app, /admin, /pay)`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      logger.warn(`Second ${signal} received; ignoring`);
      return;
    }
    shuttingDown = true;
    logger.info(`${signal} received, shutting down…`);
    scheduler.stop();
    await alertWorker.stop();
    // close http first so no new requests come in, then drain the pool.
    // awaited so we don't lose in-flight requests on a quick restart.
    await new Promise<void>(resolve => healthServer.close(() => resolve()));
    try {
      await bot.stop();
    } catch (error) {
      logger.error('Error stopping bot', error);
    }
    try {
      await pool.end();
    } catch (error) {
      logger.error('Error closing pool', error);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // An uncaught exception leaves the process in an undefined state - log it and
  // exit non-zero so docker's restart policy hands us a clean one, rather than
  // limping along wedged. Rejections we only log; one bad promise usually isn't
  // grounds to tear down the whole process.
  process.on('unhandledRejection', reason => {
    logger.error('Unhandled promise rejection', reason);
  });
  process.on('uncaughtException', error => {
    logger.error('Uncaught exception', error);
    process.exit(1);
  });

  scheduler.start();
  alertWorker.start();

  // telegram's "/" autocomplete menu (user-facing commands only)
  try {
    await bot.api.setMyCommands([
      { command: 'register', description: 'Add your DESCO meter' },
      { command: 'balance', description: 'Check balances right now' },
      { command: 'dashboard', description: 'Balance history charts' },
      { command: 'settings', description: 'Tone, quiet hours, thresholds' },
      { command: 'menu', description: 'Quick action buttons' },
      { command: 'threshold', description: 'Set alert levels' },
      { command: 'nickname', description: 'Name your meter' },
      { command: 'sms', description: 'Get alerts by SMS (paid plans)' },
      { command: 'discord', description: 'Get alerts in Discord (free)' },
      { command: 'email', description: 'Use the web app with this account' },
      { command: 'plan', description: 'Your current plan' },
      { command: 'upgrade', description: 'More meters, SMS alerts' },
      { command: 'meters', description: 'List your meters' },
      { command: 'stop', description: 'Pause all monitoring' },
      { command: 'delete', description: 'Erase your account and data' },
      { command: 'privacy', description: 'What we store and why' },
      { command: 'help', description: 'All commands' },
    ]);
  } catch (error) {
    logger.warn('setMyCommands failed (fine in mock mode)', error);
  }

  // Discord's equivalent of setMyCommands: bulk-overwrite the global slash
  // commands. Idempotent, so every boot converges on command-defs.ts.
  if (discordApi && config.discord) {
    try {
      await discordApi.setCommands(config.discord.appId, DISCORD_COMMANDS);
      logger.info('Discord slash commands registered');
    } catch (error) {
      logger.warn('Registering Discord slash commands failed', error);
    }
  }

  logger.info('Starting Telegram bot (long polling)…');
  await bot.start();
}

main().catch(error => {
  logger.error('Fatal', error);
  process.exit(1);
});
