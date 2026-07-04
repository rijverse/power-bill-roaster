import crypto from 'crypto';
import http from 'http';
import { handleDiscordInteraction } from '../../discord/interactions';
import { discordPublicKey } from '../../discord/verify';
import { DiscordApi } from '../../discord/api';
import { DiscordBot, InteractionReply } from '../../discord/bot';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicKeyHex = publicKey
  .export({ format: 'der', type: 'spki' })
  .subarray(-32)
  .toString('hex');

function signedHeaders(body: string, ts = '1700000000'): Record<string, string> {
  return {
    'x-signature-ed25519': crypto.sign(null, Buffer.from(ts + body), privateKey).toString('hex'),
    'x-signature-timestamp': ts,
  };
}

function fakeReq(headers: Record<string, string>): http.IncomingMessage {
  return { headers } as unknown as http.IncomingMessage;
}

function fakeRes() {
  const out = { status: 0, body: '' };
  const res = {
    writeHead: (status: number) => {
      out.status = status;
      return res;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  };
  return { res: res as unknown as http.ServerResponse, out };
}

function deps(bot: Partial<DiscordBot>, edits: unknown[][] = []) {
  return {
    bot: bot as DiscordBot,
    api: {
      editOriginalResponse: async (...args: unknown[]) => void edits.push(args),
    } as unknown as DiscordApi,
    appId: 'app-1',
    publicKey: discordPublicKey(publicKeyHex),
  };
}

describe('handleDiscordInteraction', () => {
  it('401s an invalid signature without invoking the bot', async () => {
    const handle = jest.fn();
    const body = '{"type":1}';
    const { res, out } = fakeRes();
    await handleDiscordInteraction(
      fakeReq({ 'x-signature-ed25519': 'ab'.repeat(64), 'x-signature-timestamp': '1' }),
      res,
      body,
      deps({ handleInteraction: handle })
    );
    expect(out.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it('401s when the signature headers are missing entirely', async () => {
    const { res, out } = fakeRes();
    await handleDiscordInteraction(fakeReq({}), res, '{"type":1}', deps({}));
    expect(out.status).toBe(401);
  });

  it('answers a signed PING with PONG', async () => {
    const body = '{"type":1}';
    const { res, out } = fakeRes();
    await handleDiscordInteraction(
      fakeReq(signedHeaders(body)),
      res,
      body,
      deps({ handleInteraction: async () => ({ immediate: { type: 1 } }) })
    );
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ type: 1 });
  });

  it('400s a signed but malformed JSON body', async () => {
    const body = 'not json';
    const { res, out } = fakeRes();
    await handleDiscordInteraction(fakeReq(signedHeaders(body)), res, body, deps({}));
    expect(out.status).toBe(400);
  });

  it('runs deferred work after responding and edits the original response', async () => {
    const body = JSON.stringify({ type: 2, token: 'tok-1', data: { name: 'balance' } });
    const edits: unknown[][] = [];
    const reply: InteractionReply = {
      immediate: { type: 5, data: { flags: 64 } },
      followUp: async () => ({ content: 'done' }),
    };
    const { res, out } = fakeRes();
    await handleDiscordInteraction(
      fakeReq(signedHeaders(body)),
      res,
      body,
      deps({ handleInteraction: async () => reply }, edits)
    );
    expect(JSON.parse(out.body).type).toBe(5);
    expect(edits).toEqual([['app-1', 'tok-1', { content: 'done' }]]);
  });

  it('resolves the placeholder with an apology when deferred work throws', async () => {
    const body = JSON.stringify({ type: 2, token: 'tok-2', data: { name: 'register' } });
    const edits: unknown[][] = [];
    const reply: InteractionReply = {
      immediate: { type: 5, data: { flags: 64 } },
      followUp: async () => {
        throw new Error('desco exploded');
      },
    };
    const { res } = fakeRes();
    await handleDiscordInteraction(
      fakeReq(signedHeaders(body)),
      res,
      body,
      deps({ handleInteraction: async () => reply }, edits)
    );
    expect(edits).toHaveLength(1);
    expect((edits[0][2] as { content: string }).content).toMatch(/try again/i);
  });
});
