import { AdminRoute, CLIENT_PARSE_HASH, parseHash, serializeHash } from '../../web/admin-hash';

// The admin panel's inlined script can't import, so it carries its own parser.
// That copy used to be hand-mirrored, which is how the two drifted. It now ships
// as a JS string from admin-hash.ts, and this evaluates that string and runs it
// against the server parser on the same inputs - which is what makes "shared"
// mean something rather than just "moved".
// Evaluating the string is the entire point: it's the exact source the browser
// runs, so anything short of executing it would be testing a copy of a copy.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const parseHashClient = new Function(`${CLIENT_PARSE_HASH}\nreturn parseHashClient;`)() as (
  hash: string
) => AdminRoute;

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

  describe('the client copy agrees with the server on every input', () => {
    const CASES = [
      '#user/12',
      '#user/abc', // bogus id -> falls back
      '#users',
      '#users/q=017',
      '#users/q=%E0%A6%B9', // percent-encoded Bangla
      '#users/q=%', // malformed escape must not throw - falls back to raw
      '#logs',
      '#logs/failed',
      '#logs/sent',
      '#logs/bogus', // unknown filter -> all
      '#audit',
      '#revenue',
      '',
      '#garbage',
      'users', // no leading '#'
    ];

    it.each(CASES)('%p', hash => {
      expect(parseHashClient(hash)).toEqual(parseHash(hash));
    });
  });
});
