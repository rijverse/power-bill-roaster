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
  const smsGateway = createSmsGateway(config);
  if (smsGateway) {
    console.log(`SMS channel enabled via ${smsGateway.name} gateway`);
  }
  const dispatcher = new Dispatcher(db, telegramSender, smsGateway);
  const scheduler = new Scheduler(db, telegramSender, dispatcher, config, subscriptions);

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
  console.log('Starting Telegram bot (long polling)…');
  await bot.start();
}

main().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});
