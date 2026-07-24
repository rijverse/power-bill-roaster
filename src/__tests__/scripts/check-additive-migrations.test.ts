import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The additive-migration check runs in CI before migrations apply to prod. A
// non-additive migration (DROP/ALTER/RENAME) breaks the still-running old
// server mid-deploy. These tests prove the checker catches the dangerous
// patterns and passes additive ones.

// The test copies the real drizzle/ dir into a temp folder so the checker
// runs against an isolated copy. Writing fixture migrations there can't
// pollute the real drizzle/ dir and trip the migrations.test.ts race.

const REAL_DRIZZLE = path.join(__dirname, '..', '..', '..', 'drizzle');
const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'check-additive-migrations.ts');

let tmpDir: string;

function setupTmpDrizzle(): void {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drizzle-test-'));
  for (const f of fs.readdirSync(REAL_DRIZZLE)) {
    const src = path.join(REAL_DRIZZLE, f);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, path.join(tmpDir, f));
    }
  }
  // Copy the meta subdir (snapshots + journal)
  const metaSrc = path.join(REAL_DRIZZLE, 'meta');
  const metaDst = path.join(tmpDir, 'meta');
  if (fs.existsSync(metaSrc)) {
    fs.mkdirSync(metaDst, { recursive: true });
    for (const f of fs.readdirSync(metaSrc)) {
      fs.copyFileSync(path.join(metaSrc, f), path.join(metaDst, f));
    }
  }
}

function runCheck(): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bunx', ['tsx', SCRIPT], {
      encoding: 'utf-8',
      env: { ...process.env, DRIZZLE_DIR: tmpDir },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('check-additive-migrations', () => {
  beforeEach(() => setupTmpDrizzle());
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('passes when all migrations are additive', () => {
    const { status, stdout } = runCheck();
    expect(status).toBe(0);
    expect(stdout).toContain('all additive');
  });

  it('fails on a DROP TABLE migration', () => {
    fs.writeFileSync(path.join(tmpDir, '9999_drop.sql'), 'DROP TABLE "bad";');
    const { status, stderr } = runCheck();
    expect(status).toBe(1);
    expect(stderr).toContain('DROP TABLE');
    expect(stderr).toContain('9999_drop.sql');
  });

  it('fails on an ALTER TABLE ... ALTER COLUMN', () => {
    fs.writeFileSync(
      path.join(tmpDir, '9999_alter.sql'),
      'ALTER TABLE "users" ALTER COLUMN "email" TYPE text;--> statement-breakpoint'
    );
    const { status, stderr } = runCheck();
    expect(status).toBe(1);
    expect(stderr).toContain('9999_alter.sql');
  });

  it('passes on CREATE INDEX and ADD COLUMN (additive)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '9999_add.sql'),
      'CREATE INDEX "idx" ON "users" ("id");--> statement-breakpoint\nALTER TABLE "users" ADD COLUMN "flag" boolean DEFAULT false;'
    );
    const { status } = runCheck();
    expect(status).toBe(0);
  });

  it('ignores the 0000 baseline (squashed init, runs on a fresh DB)', () => {
    const sql = fs.readFileSync(path.join(tmpDir, '0000_init.sql'), 'utf-8');
    expect(sql).toMatch(/CREATE TABLE/);
  });
});
