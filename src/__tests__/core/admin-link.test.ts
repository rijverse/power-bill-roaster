import { adminDeepLink } from '../../core/admin-link';

describe('adminDeepLink', () => {
  it('builds an /admin#<hash> link for a real public URL', () => {
    expect(adminDeepLink('https://app.example.com', 'logs/failed')).toBe(
      'https://app.example.com/admin#logs/failed'
    );
    // trailing slash is trimmed
    expect(adminDeepLink('https://app.example.com/', 'user/5')).toBe(
      'https://app.example.com/admin#user/5'
    );
  });

  it('omits the link for a localhost or missing base URL', () => {
    expect(adminDeepLink('http://localhost:3000', 'logs/failed')).toBe('');
    expect(adminDeepLink('http://127.0.0.1:3000', 'logs/failed')).toBe('');
    expect(adminDeepLink('', 'logs/failed')).toBe('');
    expect(adminDeepLink(null, 'logs/failed')).toBe('');
  });
});
