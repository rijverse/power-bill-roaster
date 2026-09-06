import { escapeHtml } from '../../web/server';

// escapeHtml guards operator-facing pages (pay/expired-dash). The single quote
// was once unescaped, which is safe only as long as every attribute context
// uses double quotes; a future single-quoted attribute would be an XSS sink.
// These tests pin all five HTML-significant characters.

describe('escapeHtml', () => {
  it('escapes & < > " and the single quote', () => {
    expect(escapeHtml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
  });

  it('escapes a single-quote-only string', () => {
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('escapes an XSS payload in a single-quoted attribute shape', () => {
    expect(escapeHtml("x' onerror='alert(1)")).toBe('x&#39; onerror=&#39;alert(1)');
  });

  it('leaves safe text untouched', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });
});
