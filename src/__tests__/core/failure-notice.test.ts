import { failureNoticeTarget } from '../../core/scheduler';

// The one-time "I can't read your meter" notice must reach Discord-only users
// too - before this helper existed the gate was hard-wired to telegramChatId
// and a Discord-registered account simply never heard about a dead meter.
describe('failureNoticeTarget', () => {
  it('prefers Telegram when the account has a chat id', () => {
    expect(failureNoticeTarget({ telegramChatId: 123, discordUserId: '999' }, true)).toEqual({
      kind: 'telegram',
      chatId: 123,
    });
  });

  it('falls back to a Discord DM for a Discord-only account', () => {
    expect(failureNoticeTarget({ telegramChatId: null, discordUserId: '999' }, true)).toEqual({
      kind: 'discord',
      discordUserId: '999',
    });
  });

  it('returns null for a Discord-only account when the Discord bot is off', () => {
    expect(failureNoticeTarget({ telegramChatId: null, discordUserId: '999' }, false)).toBeNull();
  });

  it('returns null when the account has neither identity', () => {
    expect(failureNoticeTarget({ telegramChatId: null, discordUserId: null }, true)).toBeNull();
  });
});
