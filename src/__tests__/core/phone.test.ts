import { normalizeBdPhone } from '../../core/phone';

describe('normalizeBdPhone', () => {
  it('accepts the common local format', () => {
    expect(normalizeBdPhone('01712345678')).toBe('8801712345678');
  });

  it('accepts +880 and 880 prefixes', () => {
    expect(normalizeBdPhone('+8801712345678')).toBe('8801712345678');
    expect(normalizeBdPhone('8801712345678')).toBe('8801712345678');
  });

  it('tolerates spaces and dashes', () => {
    expect(normalizeBdPhone('017 1234-5678')).toBe('8801712345678');
  });

  it('accepts all BD operator prefixes (013-019)', () => {
    for (const op of ['3', '4', '5', '6', '7', '8', '9']) {
      expect(normalizeBdPhone(`01${op}12345678`)).toBe(`8801${op}12345678`);
    }
  });

  it('rejects non-BD and malformed numbers', () => {
    expect(normalizeBdPhone('01212345678')).toBeNull(); // 012 isn't a BD operator
    expect(normalizeBdPhone('0171234567')).toBeNull(); // too short
    expect(normalizeBdPhone('017123456789')).toBeNull(); // too long
    expect(normalizeBdPhone('+14155551234')).toBeNull(); // not BD
    expect(normalizeBdPhone('hello')).toBeNull();
    expect(normalizeBdPhone('')).toBeNull();
  });
});
