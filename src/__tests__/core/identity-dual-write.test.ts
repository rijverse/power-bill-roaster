import fs from 'fs';
import path from 'path';

// The identities table is mid-migration: it is dual-written alongside the legacy
// users.telegram_chat_id / discord_user_id / email columns until every reader is
// ported off them. That only holds if EVERY writer goes through linkIdentity
// (or, for merge, rebuilds the rows itself). It already broke once - the bot's
// link handlers and the web email paths stamped the legacy columns directly, so
// identities silently diverged from the real logins and merge hit an FK error.
//
// This scans for the raw write instead of trusting review, because the failure is
// invisible until something reads identities and finds it stale.

const SRC = path.join(__dirname, '..', '..');
const IDENTITY_COLUMNS = ['telegramChatId', 'discordUserId', 'email'];

// The two modules that own identity rows and keep them in step themselves.
const ALLOWED = [path.join('core', 'identities.ts'), path.join('core', 'merge-accounts.ts')];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(full);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** Comments can legitimately mention the columns; only real code counts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('identities dual-write invariant', () => {
  it('no module outside identities/merge writes the legacy identity columns', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = path.relative(SRC, file);
      if (ALLOWED.some(a => rel.endsWith(a))) {
        continue;
      }
      const code = stripComments(fs.readFileSync(file, 'utf-8'));
      // `update(schema.users).set({ ... })` - the object body may span lines,
      // which [^}]* covers since it is not newline-limited.
      const writes = code.matchAll(/update\(\s*schema\.users\s*\)\s*\.set\(\s*\{([^}]*)\}/g);
      for (const write of writes) {
        const assigned = write[1];
        const hit = IDENTITY_COLUMNS.find(col => new RegExp(`\\b${col}\\b`).test(assigned));
        if (hit) {
          violations.push(`${rel}: sets users.${hit} directly`);
        }
      }
    }
    // If this fails: route the write through linkIdentity (src/core/identities.ts)
    // so the identity row, the legacy column, and the delivery channel move
    // together. Do not just add the file to ALLOWED.
    expect(violations).toEqual([]);
  });
});
