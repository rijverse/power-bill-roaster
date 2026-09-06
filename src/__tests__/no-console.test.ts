import fs from 'fs';
import path from 'path';

// The logger masks PII (emails, phones, account/meter numbers, webhook
// tokens) on every line. console.* bypasses that masking entirely, so a
// console.error in a catch block can leak a phone number from an upstream URL.
// This test pins that production source (excluding tests, the logger itself,
// and the dev-only preview-emails script) never calls console.* directly.

const SRC = path.join(__dirname, '..', '..');

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('no console.* in production source', () => {
  const files = listTs(SRC);
  // logger.ts legitimately uses console.* (it IS the logger) and the dev-only
  // preview-emails / sign-dash-token / check-additive-migrations scripts are CLI
  // tools that print directly.
  const fileExempts = new Set([
    'logger.ts',
    'preview-emails.ts',
    'sign-dash-token.ts',
    'check-additive-migrations.ts',
  ]);
  for (const file of files) {
    const rel = path.relative(SRC, file);
    it(`${rel} uses logger, not console.*`, () => {
      const src = fs.readFileSync(file, 'utf-8');
      // strip comments so a commented-out console.log doesn't trip it
      const stripped = src.replace(/^\s*\/\/.*$/gm, '');
      if (fileExempts.has(path.basename(file))) return;
      expect(stripped).not.toMatch(/\bconsole\.(log|error|warn|info|debug)\s*\(/);
    });
  }
});
