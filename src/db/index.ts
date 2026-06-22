import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** True when the connection already opts into TLS (sslmode/ssl in the URL, or PGSSLMODE). */
function declaresTls(connectionString: string): boolean {
  if (process.env.PGSSLMODE && process.env.PGSSLMODE !== 'disable') {
    return true;
  }
  try {
    const url = new URL(connectionString);
    const sslmode = url.searchParams.get('sslmode');
    if (sslmode && sslmode !== 'disable') {
      return true;
    }
    return url.searchParams.get('ssl') === 'true';
  } catch {
    return false;
  }
}

function dbHost(connectionString: string): string | null {
  try {
    return new URL(connectionString).hostname;
  } catch {
    return null;
  }
}

export function createDb(connectionString: string): { db: Db; pool: Pool } {
  const host = dbHost(connectionString);
  const isLocal = host !== null && LOCAL_HOSTS.has(host);
  // Refuse to push customer PII and payment references over a plaintext link to
  // a remote database. Local dev/test point at a sidecar Postgres with no TLS,
  // so those are allowed; any other host must declare sslmode (set
  // ALLOW_INSECURE_DB=1 only for a database on a trusted private network).
  if (!isLocal && !declaresTls(connectionString) && process.env.ALLOW_INSECURE_DB !== '1') {
    throw new Error(
      'Refusing to connect to a remote database without TLS. Append ?sslmode=require to ' +
        'DATABASE_URL (or set ALLOW_INSECURE_DB=1 if the database is on a trusted private network).'
    );
  }

  const pool = new Pool({
    connectionString,
    // Neon and most managed Postgres cap connections; one client is also held for
    // the whole poll cycle (advisory lock), so keep the pool modest and bounded.
    max: parseInt(process.env.DB_POOL_MAX || '10'),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // a runaway query can't pin a connection (and starve the pool) forever
    statement_timeout: 30_000,
    keepAlive: true,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export * as schema from './schema';
