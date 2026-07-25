import vm from 'vm';
import { appShellHtml, loginHtml } from '../../web/app-html';
import { adminAppHtml, adminLoginHtml } from '../../web/admin-html';
import { dashboardHtml } from '../../web/dashboard-html';

// The dashboards ship their client code as inline <script> inside a template
// string, so nothing typechecks or lints it: a stray brace or a bad token is
// invisible until it breaks in a user's browser, silently, with the page half
// rendered. Compiling every generated block turns that into a failed build.
//
// Compile only - `new vm.Script` parses and throws on a syntax error without
// running anything, so no DOM is needed.

const NONCE = 'test-nonce';

const PAGES: { name: string; html: string }[] = [
  { name: 'appShellHtml', html: appShellHtml(NONCE, 'csrf-token', 'https://recharge.example') },
  { name: 'loginHtml (mail on)', html: loginHtml(NONCE, true, null) },
  { name: 'loginHtml (mail off, status)', html: loginHtml(NONCE, false, 'sent') },
  { name: 'adminAppHtml', html: adminAppHtml(NONCE, 'csrf-token') },
  { name: 'adminAppHtml (billing off)', html: adminAppHtml(NONCE, 'csrf-token', false) },
  { name: 'adminLoginHtml', html: adminLoginHtml(NONCE, true) },
  { name: 'dashboardHtml', html: dashboardHtml(NONCE, 'dash-token') },
];

/** Every inline <script> block on the page, with its opening tag. */
function scriptBlocks(html: string): { tag: string; code: string }[] {
  const blocks: { tag: string; code: string }[] = [];
  // case-insensitive: the builders emit lowercase today, but a matcher that only
  // sees <script> would quietly skip a block rather than check it
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    blocks.push({ tag: match[1], code: match[2] });
  }
  return blocks;
}

describe('generated inline scripts', () => {
  it.each(PAGES)('$name parses as valid JavaScript', ({ html }) => {
    const blocks = scriptBlocks(html).filter(
      b => !/\bsrc=/.test(b.tag) && b.code.trim().length > 0
    );
    // A page that stopped emitting scripts would make this test vacuous.
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      // Throws SyntaxError on a malformed block; compiling does not execute it.
      expect(() => new vm.Script(block.code)).not.toThrow();
    }
  });

  // A CSP nonce mismatch is the other silent failure: the browser refuses the
  // block and the page renders dead, with no server-side error at all.
  it.each(PAGES)('$name carries the CSP nonce on every inline script', ({ html }) => {
    for (const block of scriptBlocks(html)) {
      if (/\bsrc=/.test(block.tag) || block.code.trim().length === 0) {
        continue;
      }
      expect(block.tag).toContain(`nonce="${NONCE}"`);
    }
  });
});
