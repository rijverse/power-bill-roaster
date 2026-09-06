import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../db';
import { logger } from '../logger';

// Programmatic migrator instead of `drizzle-kit migrate`: drizzle-kit hides the
// real failure behind its spinner (a squashed baseline hitting an already-migrated
// DB just prints "exited with code 1"). This surfaces the actual Postgres error,
// and reuses createDb so prod migrations refuse a plaintext remote link the same
// way the app does.
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const { db, pool } = createDb(url);
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    logger.info('Migrations applied');
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  logger.error('Migration failed', error);
  process.exit(1);
});
