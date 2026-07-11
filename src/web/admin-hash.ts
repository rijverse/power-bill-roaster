// Admin panel deep-link routing: #<screen>, #user/<id>, #users/q=<term>,
// #logs/failed|sent, #audit.
//
// The admin panel ships as an inlined script and can't import, so the browser
// needs its own copy of the parser. Rather than hand-mirror it (which is how the
// two drifted before), CLIENT_PARSE_HASH below is the same source shipped as a JS
// string - the same mechanism theme.ts uses for CLIENT_HELPERS - and
// admin-hash.test.ts evals it and asserts it agrees with the server parser.

export interface AdminRoute {
  screen: 'revenue' | 'users' | 'logs' | 'audit';
  detail: string | null;
  query: string;
  logStatus: 'all' | 'sent' | 'failed';
}

const BLANK: AdminRoute = { screen: 'revenue', detail: null, query: '', logStatus: 'all' };

export function parseHash(hash: string): AdminRoute {
  const h = (hash || '').replace(/^#/, '');
  const slash = h.indexOf('/');
  const head = slash === -1 ? h : h.slice(0, slash);
  const tail = slash === -1 ? '' : h.slice(slash + 1);

  if (head === 'user' && /^\d+$/.test(tail)) {
    return { ...BLANK, screen: 'users', detail: tail };
  }
  if (head === 'users') {
    return { ...BLANK, screen: 'users', query: tail.startsWith('q=') ? decode(tail.slice(2)) : '' };
  }
  if (head === 'logs') {
    return {
      ...BLANK,
      screen: 'logs',
      logStatus: tail === 'failed' || tail === 'sent' ? tail : 'all',
    };
  }
  if (head === 'audit') return { ...BLANK, screen: 'audit' };
  if (head === 'users' || head === 'logs' || head === 'revenue') return { ...BLANK, screen: head };
  return BLANK;
}

export function serializeHash(route: {
  screen: string;
  detail?: string | null;
  query?: string;
  logStatus?: string;
}): string {
  if (route.detail) return `user/${route.detail}`;
  if (route.screen === 'users' && route.query) return `users/q=${encodeURIComponent(route.query)}`;
  if (route.screen === 'logs' && route.logStatus && route.logStatus !== 'all') {
    return `logs/${route.logStatus}`;
  }
  return route.screen;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * parseHash() for the inlined admin script. Same rules, same fallbacks - notably
 * a malformed %-escape must not throw out of the hashchange handler, so decode
 * falls back to the raw text. Kept honest by admin-hash.test.ts, which runs both
 * against the same table of inputs.
 */
export const CLIENT_PARSE_HASH = `
const BLANK_ROUTE = { screen: 'revenue', detail: null, query: '', logStatus: 'all' };
const decodeHash = s => { try { return decodeURIComponent(s); } catch { return s; } };
function parseHashClient(hash) {
  const h = (hash || '').replace(/^#/, '');
  const slash = h.indexOf('/');
  const head = slash === -1 ? h : h.slice(0, slash);
  const tail = slash === -1 ? '' : h.slice(slash + 1);
  if (head === 'user' && /^[0-9]+$/.test(tail)) return { ...BLANK_ROUTE, screen: 'users', detail: tail };
  if (head === 'users') return { ...BLANK_ROUTE, screen: 'users', query: tail.indexOf('q=') === 0 ? decodeHash(tail.slice(2)) : '' };
  if (head === 'logs') return { ...BLANK_ROUTE, screen: 'logs', logStatus: (tail === 'failed' || tail === 'sent') ? tail : 'all' };
  if (head === 'audit') return { ...BLANK_ROUTE, screen: 'audit' };
  if (head === 'revenue') return { ...BLANK_ROUTE, screen: 'revenue' };
  return { ...BLANK_ROUTE };
}`;
