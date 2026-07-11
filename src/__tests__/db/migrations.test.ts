import fs from 'fs';
import path from 'path';

// drizzle's migrator skips already-applied migrations by their journal `when`
// timestamp - it never re-reads their content. That makes two things easy to
// get wrong and catastrophic in production: a journal entry without its .sql
// file (migrate throws), and a schema change smuggled into an already-applied
// file (existing databases silently never get it - the discord_user_id
// column shipped that way once and would have taken every deployed instance
// down). These tests pin the invariants.

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
      const snapshot = path.join(DRIZZLE_DIR, 'meta', `${String(e.idx).padStart(4, '0')}_snapshot.json`);
      expect(fs.existsSync(snapshot)).toBe(true);
    }
  });
});

describe('discord_user_id backfill (regression: edited-in-place 0000)', () => {
  it('ships as its own idempotent migration so pre-Discord databases converge', () => {
    const entries = readJournal();
    const backfill = entries.find(e => e.tag.includes('discord_id_backfill'));
    expect(backfill).toBeDefined();
    const sql = fs.readFileSync(path.join(DRIZZLE_DIR, `${backfill!.tag}.sql`), 'utf-8');
    // IF NOT EXISTS makes it a no-op on fresh databases whose 0000 already
    // created the column, and the real ALTER everywhere else.
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "discord_user_id"/);
    expect(sql).toMatch(/users_discord_user_id_unique/);
  });
});
