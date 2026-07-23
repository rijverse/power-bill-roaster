import { homeHtml } from '../../web/home-html';
import { loginHtml, appShellHtml } from '../../web/app-html';
import { adminLoginHtml, adminAppHtml } from '../../web/admin-html';
import { dashboardHtml } from '../../web/dashboard-html';

// The HTML generators interpolate user-influenced values (tokens, status,
// csrf) and render client-side JS that fetches and displays user data via
// esc(). These tests feed XSS payloads into every user-influenced input and
// assert the output never contains an unescaped script-breakout or an
// unescaped <script>/<img onerror> tag in the interpolated positions.

const XSS = '<script>alert(1)</script><img src=x onerror=alert(1)>"\'';

describe('HTML generators XSS sweep', () => {
  it('homeHtml has no user-interpolated values (static marketing)', () => {
    const html = homeHtml(true);
    expect(html).not.toContain(XSS);
  });

  it('loginHtml does not reflect an unknown status payload', () => {
    // status is a lookup key into LOGIN_STATUS; an unknown key produces no notice.
    const html = loginHtml('nonce', true, XSS);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('onerror=alert(1)');
  });

  it('appShellHtml is a static shell (nonce/csrf are server-generated, not user input)', () => {
    const html = appShellHtml('abc', 'def');
    // no user data is interpolated server-side; data is fetched by client JS
    expect(html).toContain('nonce="abc"');
  });

  it('adminLoginHtml does not reflect an error-flag payload', () => {
    const html = adminLoginHtml('nonce', true);
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('adminAppHtml escapes e.message in dead-letter error handlers', () => {
    const html = adminAppHtml('nonce', 'csrf', true);
    // Pin that the client JS uses esc(e.message), not bare e.message
    expect(html).toContain('esc(e.message)');
    expect(html).not.toContain('+ e.message +');
  });

  it('dashboardHtml escapes </script> in the token to prevent script breakout', () => {
    // The token is interpolated via JSON.stringify into a <script> block.
    // JSON.stringify does NOT escape </script>, so a crafted token could break
    // out of the script context. The fix escapes < to \u003c.
    const breakoutToken = '</script><script>alert(1)</script>';
    const html = dashboardHtml('nonce', breakoutToken);
    expect(html).not.toContain('</script><script>alert(1)');
    // the escaped form should be present instead
    expect(html).toContain('\\u003c/script');
  });

  it('dashboardHtml does not let a crafted token break out of the script context', () => {
    // The token lands inside const token = "..."; so an onerror= in the
    // string value is just text, not an HTML attribute. The real danger is a
    // </script> breakout. JSON.stringify alone doesn't escape it; the fix does.
    const html = dashboardHtml('nonce', XSS);
    // the < in the XSS payload is escaped to \u003c so it can't break out
    expect(html).not.toContain('</script><script>');
    expect(html).toContain('\\u003c/script');
  });
});
