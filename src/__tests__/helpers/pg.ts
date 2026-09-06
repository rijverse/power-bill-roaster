import path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Db } from '../../db';
import * as schema from '../../db/schema';

// A real Postgres for the integration suites. The unit tests run against
// in-memory fakes, which is fast but structurally blind to the things that
// actually broke here: foreign keys, transactions, and unique indexes. A fake
// cannot reject a write, so a missing FK cleanup passes 600 green tests and then
// throws in production.
//
// Every run gets its own throwaway database, created and dropped around the
// suite. It never touches the configured database (that holds real dev data) -
// only the maintenance database is opened, to CREATE/DROP a `pr_test_*` name.

let counter = 0;

export interface TestDbHandle {
  db: Db;
  pool: Pool;
  /** Drop the throwaway database. Always call this in afterAll. */
  close(): Promise<void>;
}

function urlWithDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

export async function createTestDb(): Promise<TestDbHandle> {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL is required to run the integration suites');
  }
  const configured = new URL(base).pathname.replace(/^\//, '');
  const name = `pr_test_${process.pid}_${++counter}`;
  if (name === configured) {
    throw new Error('refusing to run integration tests against the configured database');
  }
  const adminUrl = urlWithDatabase(base, 'postgres');

  const admin = new Pool({ connectionString: adminUrl });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: urlWithDatabase(base, name) });
  const db = drizzle(pool, { schema }) as unknown as Db;
  await migrate(db, {
    migrationsFolder: path.join(__dirname, '..', '..', '..', 'drizzle'),
  });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
      const cleanup = new Pool({ connectionString: adminUrl });
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}"`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

// 23503 foreign key, 23505 unique, 23514 check
const CONSTRAINT_CODES = new Set(['23503', '23505', '23514']);

/**
 * True when a constraint rejected the write. Drizzle wraps the driver error in
 * its own ("Failed query: ..."), so the SQLSTATE lives on `cause` rather than the
 * thrown error - walk the chain instead of trusting the top level.
 */
export function isConstraintViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && CONSTRAINT_CODES.has(code)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
