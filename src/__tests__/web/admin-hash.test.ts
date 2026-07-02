import { parseHash, serializeHash } from '../../web/admin-hash';

describe('admin hash routing', () => {
  it('parses screens, user detail, search, and the log filter', () => {
    expect(parseHash('#users')).toMatchObject({ screen: 'users', detail: null });
    expect(parseHash('#user/123')).toMatchObject({ screen: 'users', detail: '123' });
    expect(parseHash('#users/q=017')).toMatchObject({ screen: 'users', query: '017' });
    expect(parseHash('#logs/failed')).toMatchObject({ screen: 'logs', logStatus: 'failed' });
    expect(parseHash('#audit')).toMatchObject({ screen: 'audit' });
    expect(parseHash('')).toMatchObject({ screen: 'revenue' });
  });

  it('ignores a bogus user id', () => {
    expect(parseHash('#user/abc')).toMatchObject({ screen: 'revenue', detail: null });
  });

  it('round-trips through serialize', () => {
    for (const h of ['user/123', 'users/q=hello', 'logs/failed', 'audit', 'revenue']) {
      expect(serializeHash(parseHash(`#${h}`))).toBe(h);
    }
  });
});
