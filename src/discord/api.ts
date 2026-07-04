import { fetchWithTimeout } from '../core/http';
import { DiscordEmbed } from '../notifications/discord';

const DEFAULT_API_BASE = 'https://discord.com/api/v10';
// DM channel ids are stable per user; cache them so alerts don't pay an extra
// round-trip every send. Bounded so a long-lived process can't grow forever.
const DM_CHANNEL_CACHE_MAX = 10_000;

export interface DiscordMessagePayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

/**
 * Discord REST client used by the bot. Three calls: register the slash
 * command set, DM a user (for alerts), and edit a deferred interaction
 * response. Same shape as the rest of the app's outbound HTTP -
 * fetchWithTimeout, throw on non-2xx, caller decides about retries.
 */
export class DiscordApi {
  private dmChannels = new Map<string, string>();

  constructor(
    private botToken: string,
    private baseUrl: string = DEFAULT_API_BASE
  ) {}

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bot ${this.botToken}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Discord API ${method} ${path} returned ${response.status}`);
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  /** Bulk-overwrite the app's global slash commands (idempotent). */
  async setCommands(appId: string, commands: unknown[]): Promise<void> {
    await this.request('PUT', `/applications/${appId}/commands`, commands);
  }

  /**
   * DM a user. Throws if the DM can't be opened or sent (closed DMs, no
   * mutual server) - the alert dispatcher records that as a failed delivery.
   */
  async sendDm(discordUserId: string, payload: DiscordMessagePayload): Promise<void> {
    const channelId = await this.dmChannelFor(discordUserId);
    await this.request('POST', `/channels/${channelId}/messages`, payload);
  }

  private async dmChannelFor(discordUserId: string): Promise<string> {
    const cached = this.dmChannels.get(discordUserId);
    if (cached) {
      return cached;
    }
    const channel = (await this.request('POST', '/users/@me/channels', {
      recipient_id: discordUserId,
    })) as { id: string };
    if (this.dmChannels.size >= DM_CHANNEL_CACHE_MAX) {
      this.dmChannels.clear();
    }
    this.dmChannels.set(discordUserId, channel.id);
    return channel.id;
  }

  /**
   * Replace a deferred interaction's "thinking…" placeholder with the real
   * reply. Authenticated by the interaction token, not the bot token, but the
   * bot header does no harm.
   */
  async editOriginalResponse(
    appId: string,
    interactionToken: string,
    payload: DiscordMessagePayload
  ): Promise<void> {
    await this.request('PATCH', `/webhooks/${appId}/${interactionToken}/messages/@original`, payload);
  }
}
