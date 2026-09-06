import { createDb } from '../../db';

// The pools below are never queried, so no real Postgres is contacted; we still
// end() them so jest sees no lingering handles.
describe('createDb TLS guard', () => {
  afterEach(() => {
    delete process.env.ALLOW_INSECURE_DB;
    delete process.env.PGSSLMODE;
  });

  it('allows a local database without TLS', async () => {
    const { pool } = createDb('postgres://u:p@localhost:5432/app');
    await pool.end();
  });

  it('refuses a remote database without TLS', () => {
    expect(() => createDb('postgres://u:p@db.example.com:5432/app')).toThrow(/without TLS/);
  });

  it('allows a remote database that declares sslmode=require', async () => {
    const { pool } = createDb('postgres://u:p@db.example.com:5432/app?sslmode=require');
    await pool.end();
  });

  it('allows a remote database when ALLOW_INSECURE_DB=1', async () => {
    process.env.ALLOW_INSECURE_DB = '1';
    const { pool } = createDb('postgres://u:p@db.example.com:5432/app');
    await pool.end();
  });
});
