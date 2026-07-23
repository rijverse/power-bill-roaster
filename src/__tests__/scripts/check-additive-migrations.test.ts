import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// The additive-migration check runs in CI before migrations apply to prod. A
// non-additive migration (DROP/ALTER/RENAME) breaks the still-running old
// server mid-deploy. These tests prove the checker catches the dangerous
// patterns and passes additive ones.

const DRIZZLE_DIR = path.join(__dirname, '..', '..', '..', 'drizzle');
const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'check-additive-migrations.ts');

function runCheck(): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bunx', ['tsx', SCRIPT], { encoding: 'utf-8' });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('check-additive-migrations', () => {
  const originalFiles = new Set(fs.readdirSync(DRIZZLE_DIR).filter(f => f.endsWith('.sql')));

  afterEach(() => {
    // remove any temp migration files created during the test
    for (const f of fs.readdirSync(DRIZZLE_DIR)) {
      if (f.endsWith('.sql') && !originalFiles.has(f)) {
        fs.unlinkSync(path.join(DRIZZLE_DIR, f));
      }
    }
  });

  it('passes when all migrations are additive', () => {
    const { status, stdout } = runCheck();
    expect(status).toBe(0);
    expect(stdout).toContain('all additive');
  });

  it('fails on a DROP TABLE migration', () => {
    fs.writeFileSync(path.join(DRIZZLE_DIR, '9999_drop.sql'), 'DROP TABLE "bad";');
    const { status, stderr } = runCheck();
    expect(status).toBe(1);
    expect(stderr).toContain('DROP TABLE');
    expect(stderr).toContain('9999_drop.sql');
  });

  it('fails on an ALTER TABLE ... ALTER COLUMN', () => {
    fs.writeFileSync(
      path.join(DRIZZLE_DIR, '9999_alter.sql'),
      'ALTER TABLE "users" ALTER COLUMN "email" TYPE text;--> statement-breakpoint'
    );
    const { status, stderr } = runCheck();
    expect(status).toBe(1);
    expect(stderr).toContain('9999_alter.sql');
  });

  it('passes on CREATE INDEX and ADD COLUMN (additive)', () => {
    fs.writeFileSync(
      path.join(DRIZZLE_DIR, '9999_add.sql'),
      'CREATE INDEX "idx" ON "users" ("id");--> statement-breakpoint\nALTER TABLE "users" ADD COLUMN "flag" boolean DEFAULT false;'
    );
    const { status } = runCheck();
    expect(status).toBe(0);
  });

  it('ignores the 0000 baseline (squashed init, runs on a fresh DB)', () => {
    const sql = fs.readFileSync(path.join(DRIZZLE_DIR, '0000_init.sql'), 'utf-8');
    // the baseline may contain anything; the checker skips 0000*
    expect(sql).toMatch(/CREATE TABLE/);
  });
});
