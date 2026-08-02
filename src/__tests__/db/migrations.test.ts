import fs from 'fs';
import path from 'path';

// drizzle's migrator skips already-applied migrations by their journal `when`
// timestamp - it never re-reads their content. That makes two things easy to
// get wrong and catastrophic in production: a journal entry without its .sql
// file (migrate throws), and a schema change smuggled into an already-applied
// file (existing databases silently never get it - the discord_user_id
// column shipped that way once, pre-launch, and would have taken every
// deployed instance down). The dev history was squashed to a single init
// migration before first deploy; from now on every schema change must be a
// NEW migration file. These tests pin the invariants.

const DRIZZLE_DIR = path.join(__dirname, '..', '..', '..', 'drizzle');

type JournalEntry = { idx: number; when: number; tag: string };

function readJournal(): JournalEntry[] {
  const raw = fs.readFileSync(path.join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf-8');
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

describe('drizzle migration journal', () => {
  it('has exactly one .sql file per journal entry (and no strays)', () => {
    const entries = readJournal();
    const sqlFiles = fs
      .readdirSync(DRIZZLE_DIR)
      .filter(f => f.endsWith('.sql'))
      .map(f => f.replace(/\.sql$/, ''))
      .sort();
    const tags = entries.map(e => e.tag).sort();
    expect(sqlFiles).toEqual(tags);
  });

  it('orders entries by strictly increasing idx and when', () => {
    const entries = readJournal();
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].idx).toBe(entries[i - 1].idx + 1);
      expect(entries[i].when).toBeGreaterThan(entries[i - 1].when);
    }
  });

  it('has a snapshot per migration', () => {
    const entries = readJournal();
    for (const e of entries) {
      const snapshot = path.join(
        DRIZZLE_DIR,
        'meta',
        `${String(e.idx).padStart(4, '0')}_snapshot.json`
      );
      expect(fs.existsSync(snapshot)).toBe(true);
    }
  });
});

describe('init migration (squashed pre-launch)', () => {
  it('creates the identities table and its uniques in one place', () => {
    const entries = readJournal();
    const sql = fs.readFileSync(path.join(DRIZZLE_DIR, `${entries[0].tag}.sql`), 'utf-8');
    // Logins live in identities now (one row per provider). Its two uniques -
    // globally unique per (provider, uid) and at most one per (user, provider) -
    // must exist from migration one, the way the users identity columns used to.
    expect(sql).toMatch(/CREATE TABLE "identities"/);
    expect(sql).toMatch(/identities_provider_uid_idx/);
    expect(sql).toMatch(/identities_user_provider_idx/);
  });
});

describe('hot-path indexes', () => {
  it('indexes every hot path the dispatcher and admin queries hit', () => {
    const entries = readJournal();
    const sql = fs.readFileSync(path.join(DRIZZLE_DIR, `${entries[0].tag}.sql`), 'utf-8');

    // alerts_log: append-only, scanned by admin overview ($count sentAt >= dayAgo),
    // the 24h delivery counts ($count deliveryStatus+sentAt), the deliveries list
    // (ORDER BY sentAt, join on meterId), and the per-alert SMS budget $count.
    expect(sql).toMatch(
      /CREATE INDEX "alerts_log_sent_at_idx" ON "alerts_log" USING btree \("sent_at"\)/
    );
    expect(sql).toMatch(
      /CREATE INDEX "alerts_log_status_sent_idx" ON "alerts_log" USING btree \("delivery_status","sent_at"\)/
    );
    expect(sql).toMatch(
      /CREATE INDEX "alerts_log_meter_idx" ON "alerts_log" USING btree \("meter_id"\)/
    );
    // channels: dispatcher loads a user's channels WHERE user_id = ? per alert.
    expect(sql).toMatch(/CREATE INDEX "channels_user_idx" ON "channels" USING btree \("user_id"\)/);
    // subscriptions: activeFor (user_id, status) and expireOverdue (status, period_end).
    expect(sql).toMatch(
      /CREATE INDEX "subscriptions_user_status_idx" ON "subscriptions" USING btree \("user_id","status"\)/
    );
    expect(sql).toMatch(
      /CREATE INDEX "subscriptions_status_period_end_idx" ON "subscriptions" USING btree \("status","current_period_end"\)/
    );
  });
});
