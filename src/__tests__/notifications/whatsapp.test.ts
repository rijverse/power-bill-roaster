import http from 'http';
import crypto from 'crypto';
import { createWhatsAppSender, ConsoleWhatsAppSender } from '../../notifications/whatsapp';
import {
  handleWhatsAppVerification,
  handleWhatsAppEvent,
  WhatsAppInboundDeps,
} from '../../notifications/whatsapp/webhook';
import { signWhatsAppConnectToken } from '../../web/user-auth';
import { Db, schema } from '../../db';
import { ServerConfig } from '../../config';

const SECRET = 'dash-secret';
const APP_SECRET = 'wa-app-secret';
const VERIFY_TOKEN = 'verify-me';

function fakeRes() {
  const state = { status: 0, body: '' };
  const res = {
    writeHead(status: number) {
      state.status = status;
      return res;
    },
    end(body?: string) {
      if (body) state.body = body;
      return res;
    },
  };
  return { res: res as unknown as http.ServerResponse, state };
}

function fakeDb() {
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const db = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return { then: (resolve: (v: unknown) => void) => resolve(undefined) };
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  } as unknown as Db;
  return { db, inserts };
}

function deps(db: Db): WhatsAppInboundDeps {
  return { db, secret: SECRET, verifyToken: VERIFY_TOKEN, appSecret: APP_SECRET, sender: null };
}

function sign(rawBody: string): string {
  return 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
}

function inboundBody(from: string, text: string): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { messages: [{ from, type: 'text', text: { body: text } }] } }] }],
  });
}

describe('createWhatsAppSender', () => {
  it('returns null when WhatsApp is not configured', () => {
    expect(createWhatsAppSender({ whatsapp: null } as unknown as ServerConfig)).toBeNull();
  });

  it('returns the console stub when configured', () => {
    const sender = createWhatsAppSender({ whatsapp: {} } as unknown as ServerConfig);
    expect(sender).toBeInstanceOf(ConsoleWhatsAppSender);
  });
});

describe('WhatsApp webhook verification (GET)', () => {
  it('echoes the challenge when the verify token matches', () => {
    const { db } = fakeDb();
    const { res, state } = fakeRes();
    const url = new URL(
      `http://x/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=CHAL123`
    );
    handleWhatsAppVerification(url, res, deps(db));
    expect(state.status).toBe(200);
    expect(state.body).toBe('CHAL123');
  });

  it('403s a wrong verify token', () => {
    const { db } = fakeDb();
    const { res, state } = fakeRes();
    const url = new URL(
      'http://x/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CHAL'
    );
    handleWhatsAppVerification(url, res, deps(db));
    expect(state.status).toBe(403);
  });
});

describe('WhatsApp webhook events (POST)', () => {
  it('401s a bad signature and never touches the db', async () => {
    const { db, inserts } = fakeDb();
    const { res, state } = fakeRes();
    const raw = inboundBody('8801700000000', 'hello');
    const req = {
      headers: { 'x-hub-signature-256': 'sha256=deadbeef' },
    } as unknown as http.IncomingMessage;
    await handleWhatsAppEvent(req, res, raw, deps(db));
    expect(state.status).toBe(401);
    expect(inserts).toHaveLength(0);
  });

  it('links the sender number to the account on a valid "connect <token>" message', async () => {
    const { db, inserts } = fakeDb();
    const { res, state } = fakeRes();
    const token = signWhatsAppConnectToken(42, SECRET);
    const raw = inboundBody('8801711111111', `connect ${token}`);
    const req = {
      headers: { 'x-hub-signature-256': sign(raw) },
    } as unknown as http.IncomingMessage;
    await handleWhatsAppEvent(req, res, raw, deps(db));
    expect(state.status).toBe(200);
    const channel = inserts.find(i => i.table === schema.channels);
    expect(channel?.values).toMatchObject({
      userId: 42,
      type: 'whatsapp',
      address: '8801711111111',
      verified: true,
    });
  });

  it('ignores a valid message whose token is bogus', async () => {
    const { db, inserts } = fakeDb();
    const { res, state } = fakeRes();
    const raw = inboundBody('8801722222222', 'connect not-a-real-token');
    const req = {
      headers: { 'x-hub-signature-256': sign(raw) },
    } as unknown as http.IncomingMessage;
    await handleWhatsAppEvent(req, res, raw, deps(db));
    expect(state.status).toBe(200); // acked, but nothing linked
    expect(inserts).toHaveLength(0);
  });
});
