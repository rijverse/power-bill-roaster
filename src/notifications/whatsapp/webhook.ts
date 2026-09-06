import http from 'http';
import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { Db, schema } from '../../db';
import { verifyWhatsAppConnectToken } from '../../web/user-auth';
import { WhatsAppSender } from './types';
import { logger, maskPhone } from '../../logger';

// Inbound side of the WhatsApp Cloud API. Two shapes on one path:
//   GET  - Meta's subscribe handshake (echo hub.challenge when the token matches)
//   POST - message events, signed with X-Hub-Signature-256 over the raw body
// A user connects by sending "connect <token>" (prefilled by the wa.me deep link
// the dashboard hands out); we read the token back, verify it, and attach the
// sender's number as a verified whatsapp channel. Mirrors discord/interactions.

export interface WhatsAppInboundDeps {
  db: Db;
  /** signs/verifies the wa-connect token (config.dashboardSecret) */
  secret: string;
  /** the token configured in the Meta dashboard, matched on the GET handshake */
  verifyToken: string;
  /** app secret, for the X-Hub-Signature-256 HMAC on POSTs */
  appSecret: string;
  /** confirmation sender; stubbed today, so this just logs */
  sender: WhatsAppSender | null;
}

interface InboundMessage {
  from: string;
  body: string;
}

interface WebhookBody {
  entry?: {
    changes?: {
      value?: {
        messages?: { from?: string; type?: string; text?: { body?: string } }[];
      };
    }[];
  }[];
}

/** GET handshake: echo the challenge only when the verify token matches. */
export function handleWhatsAppVerification(
  url: URL,
  res: http.ServerResponse,
  deps: WhatsAppInboundDeps
): void {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge') ?? '';
  if (mode === 'subscribe' && token === deps.verifyToken) {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end(challenge);
    return;
  }
  res.writeHead(403).end();
}

function signatureValid(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header) {
    return false;
  }
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const got = Buffer.from(header);
  const want = Buffer.from(expected);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function textMessages(body: WebhookBody): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (message.type === 'text' && message.from && message.text?.body) {
          out.push({ from: message.from, body: message.text.body });
        }
      }
    }
  }
  return out;
}

async function upsertWhatsAppChannel(db: Db, userId: number, phone: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.channels)
    .where(
      and(
        eq(schema.channels.userId, userId),
        eq(schema.channels.type, 'whatsapp'),
        eq(schema.channels.address, phone)
      )
    );
  if (existing) {
    await db
      .update(schema.channels)
      .set({ verified: true, enabled: true })
      .where(eq(schema.channels.id, existing.id));
  } else {
    await db
      .insert(schema.channels)
      .values({ userId, type: 'whatsapp', address: phone, verified: true });
  }
}

const CONNECT_RE = /connect\s+(\S+)/i;

async function tryConnect(message: InboundMessage, deps: WhatsAppInboundDeps): Promise<void> {
  const match = CONNECT_RE.exec(message.body.trim());
  if (!match) {
    return;
  }
  const userId = verifyWhatsAppConnectToken(match[1], deps.secret);
  if (userId === null) {
    return;
  }
  await upsertWhatsAppChannel(deps.db, userId, message.from);
  if (deps.sender) {
    try {
      await deps.sender.send(message.from, 'Connected ✅ Low-balance alerts will reach you here.');
    } catch (error) {
      logger.error(
        'WhatsApp connect confirmation failed',
        error instanceof Error ? error.message : error
      );
    }
  }
  logger.info(`WhatsApp connected for user ${userId} -> ${maskPhone(message.from)}`);
}

/**
 * POST events. Verify the signature, then ack fast (200) so Meta doesn't retry,
 * and process any "connect <token>" messages best-effort.
 */
export async function handleWhatsAppEvent(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawBody: string,
  deps: WhatsAppInboundDeps
): Promise<void> {
  const sig = req.headers['x-hub-signature-256'];
  if (!signatureValid(rawBody, typeof sig === 'string' ? sig : undefined, deps.appSecret)) {
    res.writeHead(401).end();
    return;
  }
  res.writeHead(200).end();
  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return;
  }
  for (const message of textMessages(body)) {
    await tryConnect(message, deps);
  }
}
