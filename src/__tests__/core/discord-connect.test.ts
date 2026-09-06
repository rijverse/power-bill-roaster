import {
  connectDiscordWebhook,
  disableDiscordWebhook,
  CONNECTED_EMBED,
} from '../../core/discord-connect';
import { Db, schema } from '../../db';

const WEBHOOK = 'https://discord.com/api/webhooks/1/token';

interface Writes {
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
}

function fakeDb(existing: Partial<schema.Channel> | null, writes: Writes): Db {
  return {
    select: () => ({ from: () => ({ where: async () => (existing ? [existing] : []) }) }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => void writes.inserts.push(row),
    }),
    update: () => ({
      set: (row: Record<string, unknown>) => ({
        where: async () => void writes.updates.push(row),
      }),
    }),
  } as unknown as Db;
}

const noWrites = (): Writes => ({ inserts: [], updates: [] });

describe('connectDiscordWebhook', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => fetchSpy.mockRestore());

  it('rejects a malformed URL without touching the network or the db', async () => {
    const writes = noWrites();
    const result = await connectDiscordWebhook(fakeDb(null, writes), 1, 'https://evil.example/x');

    expect(result).toEqual({ ok: false, reason: 'invalid-url' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(writes).toEqual(noWrites());
  });

  it('rejects a non-string url', async () => {
    const result = await connectDiscordWebhook(fakeDb(null, noWrites()), 1, undefined);
    expect(result).toEqual({ ok: false, reason: 'invalid-url' });
  });

  it('saves nothing when the test send fails - a dead webhook never becomes a channel', async () => {
    // The property worth having: we only ever store a webhook we have proven works.
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 404 });
    const writes = noWrites();

    const result = await connectDiscordWebhook(fakeDb(null, writes), 1, WEBHOOK);

    expect(result).toEqual({ ok: false, reason: 'test-send-failed' });
    expect(writes).toEqual(noWrites());
  });

  it('test-sends the connected embed, then inserts a verified+enabled channel', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 204 });
    const writes = noWrites();

    const result = await connectDiscordWebhook(fakeDb(null, writes), 1, WEBHOOK);

    expect(result).toEqual({ ok: true, address: WEBHOOK });
    expect(fetchSpy.mock.calls[0][0]).toBe(WEBHOOK);
    expect(JSON.stringify(fetchSpy.mock.calls[0][1])).toContain(CONNECTED_EMBED.title);
    expect(writes.inserts).toEqual([
      { userId: 1, type: 'discord', address: WEBHOOK, verified: true, enabled: true },
    ]);
    expect(writes.updates).toEqual([]);
  });

  it('updates in place (and re-enables) when a row already exists', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 204 });
    const writes = noWrites();
    const existing = { id: 5, type: 'discord', address: 'old', enabled: false, verified: true };

    await connectDiscordWebhook(fakeDb(existing, writes), 1, WEBHOOK);

    expect(writes.inserts).toEqual([]);
    expect(writes.updates).toEqual([{ address: WEBHOOK, verified: true, enabled: true }]);
  });
});

describe('disableDiscordWebhook', () => {
  it('disables rather than deletes - alerts_log rows FK the channel', async () => {
    const writes = noWrites();
    const existing = { id: 5, type: 'discord', address: WEBHOOK, enabled: true, verified: true };

    await expect(disableDiscordWebhook(fakeDb(existing, writes), 1)).resolves.toBe('off');
    expect(writes.updates).toEqual([{ enabled: false }]);
  });

  it('reports not-on when there is no row, or it is already off', async () => {
    const writes = noWrites();
    await expect(disableDiscordWebhook(fakeDb(null, writes), 1)).resolves.toBe('not-on');

    const off = { id: 5, type: 'discord', address: WEBHOOK, enabled: false, verified: true };
    await expect(disableDiscordWebhook(fakeDb(off, writes), 1)).resolves.toBe('not-on');
    expect(writes.updates).toEqual([]);
  });
});
