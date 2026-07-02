// Admin panel deep-link routing. The client mirrors this logic inline (it ships
// as an inlined script, so it can't import), but the format is defined and
// tested here: #<screen>, #user/<id>, #users/q=<term>, #logs/failed|sent, #audit.

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
