import { getServerConfig } from './config';
import { createDb } from './db';
import { createBot } from './bot';
import { Scheduler } from './core/scheduler';
import { Dispatcher } from './notifications/dispatcher';
import { createSmsGateway } from './notifications/sms';
import { createPaymentProvider, SubscriptionService } from './billing';
import { createWebServer } from './web/server';

async function main(): Promise<void> {
  const config = getServerConfig();
  const { db, pool } = createDb(config.databaseUrl);

  const subscriptions = new SubscriptionService(db, createPaymentProvider(config));
  const bot = createBot(db, config, subscriptions);
  const telegramSender = {
    sendTelegram: async (chatId: number, text: string) => {
      await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
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

  const smsGateway = createSmsGateway(config);
  if (smsGateway) {
    console.log(`SMS channel enabled via ${smsGateway.name} gateway`);
  }
  const dispatcher = new Dispatcher(db, telegramSender, smsGateway);
  const scheduler = new Scheduler(db, pool, telegramSender, dispatcher, config, subscriptions);

  const healthServer = createWebServer(db, scheduler, config);
  healthServer.listen(config.port, () => {
    console.log(`Web server on :${config.port} (/health, /dash)`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down…`);
    scheduler.stop();
    healthServer.close();
    await bot.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  scheduler.start();

  // Telegram's "/" autocomplete menu (user-facing commands only)
  try {
    await bot.api.setMyCommands([
      { command: 'register', description: 'Add your DESCO meter' },
      { command: 'balance', description: 'Check balances right now' },
      { command: 'dashboard', description: 'Balance history charts' },
      { command: 'threshold', description: 'Set alert levels' },
      { command: 'nickname', description: 'Name your meter' },
      { command: 'sms', description: 'Get alerts by SMS (paid plans)' },
      { command: 'plan', description: 'Your current plan' },
      { command: 'upgrade', description: 'More meters, SMS alerts' },
      { command: 'meters', description: 'List your meters' },
      { command: 'stop', description: 'Pause all monitoring' },
      { command: 'delete', description: 'Erase your account and data' },
      { command: 'privacy', description: 'What we store and why' },
      { command: 'help', description: 'All commands' },
    ]);
  } catch (error) {
    console.warn('setMyCommands failed (fine in mock mode):', error);
  }

  console.log('Starting Telegram bot (long polling)…');
  await bot.start();
}

main().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});
