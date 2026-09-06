// Fan an operator alarm out to every configured operator channel. Historically
// operator alarms and dead-letter pings were Telegram-only (they assumed
// ADMIN_CHAT_ID); a Discord-only deployment got no operator alarms at all.
// Callers pass whichever channels are configured and each send is independent -
// one failing (or being absent) never suppresses the other. Alarms are rare and
// critical, so we favor redundancy over avoiding the occasional double-ping.

import { TelegramSender, DiscordDmSender } from '../notifications/dispatcher';
import { logger } from '../logger';

export interface OperatorChannels {
  telegram?: { sender: TelegramSender; chatId: number } | null;
  discord?: { dm: DiscordDmSender; userId: string } | null;
}

// Amber for warnings would be nicer per-alarm, but every caller here is a
// genuine "something is broken" page, so red across the board.
const ALARM_COLOR = 0xef4444;

export async function notifyOperator(
  channels: OperatorChannels,
  title: string,
  text: string
): Promise<void> {
  const tg = channels.telegram;
  if (tg) {
    try {
      await tg.sender.sendTelegram(tg.chatId, text);
    } catch (error) {
      logger.error('Failed to notify operator on Telegram', error);
    }
  }
  const dc = channels.discord;
  if (dc) {
    try {
      await dc.dm.sendDm(dc.userId, { title, description: text, color: ALARM_COLOR });
    } catch (error) {
      logger.error('Failed to notify operator on Discord', error);
    }
  }
}
