import { sanitizeNickname } from '../../core/sanitize';

describe('sanitizeNickname', () => {
  it('passes ordinary names through', () => {
    expect(sanitizeNickname('Flat 3B')).toBe('Flat 3B');
    expect(sanitizeNickname('Shop front')).toBe('Shop front');
  });

  it('strips Telegram-Markdown-significant characters', () => {
    expect(sanitizeNickname('Flat_3B')).toBe('Flat3B');
    expect(sanitizeNickname('*bold* [link]')).toBe('bold link');
    expect(sanitizeNickname('`code` ~strike~ |pipe| \\slash')).toBe('code strike pipe slash');
  });

  it('strips HTML angle brackets (dashboard renders the label)', () => {
    expect(sanitizeNickname('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeNickname('  Flat   3B  ')).toBe('Flat 3B');
  });

  it('returns empty string when nothing survives', () => {
    expect(sanitizeNickname('***')).toBe('');
    expect(sanitizeNickname('  ')).toBe('');
  });
});
