import { adminAppHtml } from '../../web/admin-html';

// Two dead-letter error handlers in admin-html.ts once interpolated e.message
// into innerHTML without escaping - a stored XSS sink if a future route ever
// reflected user input into the error field. The fix wraps them in esc().
// These tests pin that by asserting the rendered client JS escapes e.message
// and never interpolates it raw.

describe('admin-html dead-letter error escaping', () => {
  const html = adminAppHtml('nonce123', 'csrf456', true);

  it('escapes e.message in the requeue-all error handler', () => {
    expect(html).toContain('esc(e.message)');
    expect(html).not.toMatch(/requeue-all[^;]*;[^}]*\+ e\.message \+/);
  });

  it('does not interpolate a raw e.message into any innerHTML', () => {
    // No occurrence of '+ e.message +' (the unescaped interpolation pattern)
    expect(html).not.toContain('+ e.message +');
  });
});
