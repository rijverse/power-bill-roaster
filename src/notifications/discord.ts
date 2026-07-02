import { fetchWithTimeout } from '../core/http';

// The subset of the Discord embed object we build. The API accepts far more
// fields; we only send what the alert templates populate.
export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  /** makes the title a clickable link (we point it at the recharge URL) */
  url?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
}

// A user hands us this URL and we POST to it, so it's an SSRF vector: it must be
// a real Discord webhook and nothing else - no internal hosts, no plain http, no
// "discord.com@evil.com" userinfo trick, no path traversal. This is a strict
// allow-list; anything that doesn't parse to exactly this shape is rejected.
const WEBHOOK_PATH_RE = /^\/api\/webhooks\/\d+\/[\w-]+$/;

export function isValidDiscordWebhookUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  // userinfo would let "https://discord.com@evil.com/..." masquerade as Discord
  if (parsed.username || parsed.password) return false;
  if (parsed.hostname !== 'discord.com' && parsed.hostname !== 'discordapp.com') return false;
  // a real webhook URL never carries an explicit non-default port or a query
  if (parsed.port || parsed.search || parsed.hash) return false;
  // URL() has already normalized any ../ traversal before we test the path
  return WEBHOOK_PATH_RE.test(parsed.pathname);
}

/**
 * POSTs a single embed to a Discord webhook. Discord answers 204 on success;
 * any non-2xx (429 rate limit, 5xx, or a dead 4xx webhook) throws so the caller
 * decides what to do - the hosted outbox worker retries, the CLI reports the
 * failure. No retry loop lives here on purpose.
 */
export async function sendDiscordAlert(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
  // Guard again at the send boundary: never fetch a URL that failed validation,
  // even if a stale or hand-edited row somehow slipped past the input check.
  if (!isValidDiscordWebhookUrl(webhookUrl)) {
    throw new Error('refusing to send to a non-Discord webhook URL');
  }
  const response = await fetchWithTimeout(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!response.ok) {
    throw new Error(`Discord webhook returned ${response.status}`);
  }
}
