import http from 'http';
import { getServerConfig, ServerConfig } from './config';
import { createDb } from './db';
import { createBot } from './bot';
import { Scheduler } from './core/scheduler';

// 200 while poll cycles complete on schedule, 503 once one is overdue
// lets an external uptime monitor catch a wedged poller, not just a dead
// process.
function createHealthServer(scheduler: Scheduler, config: ServerConfig): http.Server {
  const startedAt = Date.now();
  return http.createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const intervalMs = config.pollIntervalHours * 60 * 60 * 1000;
    const last = scheduler.lastCycleCompletedAt;
    // allow one full interval of grace before the first cycle completes
    const overdue = last
      ? Date.now() - last.getTime() > intervalMs * 2
      : Date.now() - startedAt > intervalMs;
    res.writeHead(overdue ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: overdue ? 'stale' : 'ok',
        lastPollCycleAt: last?.toISOString() ?? null,
      })
    );
  });
}

async function main(): Promise<void> {
  const config = getServerConfig();
  const { db, pool } = createDb(config.databaseUrl);

  const bot = createBot(db, config);
  const scheduler = new Scheduler(
    db,
    {
      sendTelegram: async (chatId, text) => {
        await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      },
    },
    config
  );

  const healthServer = createHealthServer(scheduler, config);
  healthServer.listen(config.port, () => {
    console.log(`Health endpoint on :${config.port}/health`);
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
