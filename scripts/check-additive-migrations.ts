// Fails if any migration file (after the 0000 baseline) contains a non-additive
// statement: DROP TABLE, DROP COLUMN, ALTER COLUMN (type/default change),
// RENAME, or TRUNCATE. Additive-only (CREATE TABLE, CREATE INDEX, ADD COLUMN)
// keeps a migration safe to apply while the old server is still running, which
// is the deploy order in deploy.yml. Run in CI before migrations apply to prod.
import fs from 'fs';
import path from 'path';

const DRIZZLE_DIR = process.env.DRIZZLE_DIR
  ? path.resolve(process.env.DRIZZLE_DIR)
  : path.join(__dirname, '..', 'drizzle');

function listMigrationFiles(): string[] {
  return fs
    .readdirSync(DRIZZLE_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => path.join(DRIZZLE_DIR, f));
}

// Statements that mutate existing schema (break the running old server if
// applied mid-deploy). CREATE TABLE / CREATE INDEX / ADD COLUMN are additive
// and safe.
const NON_ADDITIVE = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bDROP\s+INDEX\b/i,
  /\bDROP\s+CONSTRAINT\b/i,
  /\bALTER\s+TABLE\b[^;]*\bALTER\s+COLUMN\b/i,
  /\bALTER\s+TABLE\b[^;]*\bDROP\b/i,
  /\bALTER\s+TABLE\b[^;]*\bRENAME\b/i,
  /\bRENAME\s+TABLE\b/i,
  /\bRENAME\s+COLUMN\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+TYPE\b/i,
];

function checkFile(filePath: string): string[] {
  const sql = fs.readFileSync(filePath, 'utf-8');
  // Split on drizzle's statement-breakpoint so each statement is checked alone.
  const statements = sql.split('--> statement-breakpoint').map(s => s.trim());
  const violations: string[] = [];
  for (const stmt of statements) {
    for (const pattern of NON_ADDITIVE) {
      if (pattern.test(stmt)) {
        violations.push(
          `${path.basename(filePath)}: non-additive statement matched ${pattern.source}: ${stmt.slice(0, 120).replace(/\n/g, ' ')}...`
        );
      }
    }
  }
  return violations;
}

function main(): void {
  const files = listMigrationFiles();
  const allViolations: string[] = [];
  for (const f of files) {
    // The 0000 baseline is a squashed init; it's allowed to contain anything
    // (it ran once on a fresh DB, never against a live server).
    if (path.basename(f).startsWith('0000')) continue;
    allViolations.push(...checkFile(f));
  }

  if (allViolations.length > 0) {
    console.error('Non-additive migrations found:\n' + allViolations.join('\n'));
    console.error('\nMigrations must be additive (CREATE TABLE / CREATE INDEX / ADD COLUMN only).');
    console.error('A DROP/ALTER/RENAME breaks the running old server when applied mid-deploy.');
    process.exit(1);
  }
  console.log(`Checked ${files.length} migration files: all additive.`);
}

main();
