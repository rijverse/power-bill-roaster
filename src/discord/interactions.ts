import http from 'http';
import crypto from 'crypto';
import { DiscordApi } from './api';
import { DiscordBot, Interaction } from './bot';
import { verifyInteractionSignature } from './verify';
import { logger } from '../logger';

export interface DiscordInteractionDeps {
  bot: DiscordBot;
  api: DiscordApi;
  appId: string;
  publicKey: crypto.KeyObject;
}

/**
 * POST /discord/interactions handler. Verifies the ed25519 signature over the
 * raw body (Discord rejects endpoints that skip this; it pokes them with
 * invalid signatures on setup), responds inside the 3s deadline, then runs
 * any deferred work and PATCHes the result back over the placeholder. The
 * web layer reads the body (its size cap applies) and routes here; this
 * owns the response.
 */
export async function handleDiscordInteraction(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawBody: string,
  deps: DiscordInteractionDeps
): Promise<void> {
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  if (
    typeof signature !== 'string' ||
    typeof timestamp !== 'string' ||
    !verifyInteractionSignature(deps.publicKey, signature, timestamp, rawBody)
  ) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid request signature' }));
    return;
  }

  let interaction: Interaction;
  try {
    interaction = JSON.parse(rawBody) as Interaction;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'malformed interaction body' }));
    return;
  }

  const reply = await deps.bot.handleInteraction(interaction);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(reply.immediate));

  // Deferred work happens after the response is on the wire - Discord shows
  // "thinking…" until the edit lands. A failure here must still resolve the
  // placeholder, or the user stares at an infinite spinner.
  if (reply.followUp && interaction.token) {
    let payload;
    try {
      payload = await reply.followUp();
    } catch (error) {
      logger.error(
        'Discord deferred command failed',
        error instanceof Error ? error.message : error
      );
      payload = { content: 'Something broke on our side. Try again in a bit.' };
    }
    try {
      await deps.api.editOriginalResponse(deps.appId, interaction.token, payload);
    } catch (error) {
      logger.error(
        'Editing the deferred Discord response failed',
        error instanceof Error ? error.message : error
      );
    }
  }
}
