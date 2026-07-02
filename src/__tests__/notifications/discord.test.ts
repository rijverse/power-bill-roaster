import {
  isValidDiscordWebhookUrl,
  sendDiscordAlert,
  DiscordEmbed,
} from '../../notifications/discord';
import { discordAlertEmbed } from '../../notifications/discord-templates';
import { MeterContext } from '../../notifications/telegram-templates';
import { RunOutPrediction } from '../../core/prediction';
import { maskWebhookUrl } from '../../logger';

const embed: DiscordEmbed = { title: 't', description: 'd', color: 1 };
const GOOD = 'https://discord.com/api/webhooks/123456789/abcDEF-_token';

describe('isValidDiscordWebhookUrl', () => {
  it('accepts canonical discord.com and discordapp.com webhooks', () => {
    expect(isValidDiscordWebhookUrl(GOOD)).toBe(true);
    expect(isValidDiscordWebhookUrl('https://discordapp.com/api/webhooks/1/tok_en-1')).toBe(true);
  });

  it('rejects anything that is not a plain Discord webhook', () => {
    const bad = [
      'http://discord.com/api/webhooks/1/tok', // not https
      'https://evil.com/api/webhooks/1/tok', // wrong host
      'https://discord.com.evil.com/api/webhooks/1/tok', // suffix host
      'https://discord.com@evil.com/api/webhooks/1/tok', // userinfo trick
      'https://discord.com:8443/api/webhooks/1/tok', // non-default port
      'https://discord.com/api/webhooks/1/tok?wait=true', // query string
      'https://discord.com/api/webhooks/abc/tok', // non-numeric id
      'https://discord.com/api/webhooks/1', // missing token
      'https://discord.com/api/webhooks/1/../../secret', // path traversal
      'https://discord.com/webhooks/1/tok', // wrong path
      'not a url',
    ];
    for (const url of bad) {
      expect(isValidDiscordWebhookUrl(url)).toBe(false);
    }
  });
});

describe('sendDiscordAlert', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('POSTs the embed and resolves on 204', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 204 });
    await expect(sendDiscordAlert(GOOD, embed)).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(GOOD);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ embeds: [embed] });
  });

  it('throws on 429 and 5xx so the caller can retry', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 429 });
    await expect(sendDiscordAlert(GOOD, embed)).rejects.toThrow('429');
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(sendDiscordAlert(GOOD, embed)).rejects.toThrow('500');
  });

  it('throws on a network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('boom'));
    await expect(sendDiscordAlert(GOOD, embed)).rejects.toThrow('boom');
  });

  it('refuses a non-Discord URL without fetching', async () => {
    await expect(sendDiscordAlert('https://evil.com/x', embed)).rejects.toThrow(/non-Discord/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

const baseCtx: MeterContext = {
  nickname: null,
  accountNo: '12345678',
  meterNo: '87654321',
  balance: 42.5,
  lowThreshold: 150,
  criticalThreshold: 100,
};

describe('discordAlertEmbed', () => {
  it('colors low, critical, and recovery distinctly', () => {
    expect(discordAlertEmbed('low-alert', baseCtx)!.color).toBe(0xfbb024);
    expect(discordAlertEmbed('critical-alert', baseCtx)!.color).toBe(0xe23b3b);
    expect(discordAlertEmbed('recovery', baseCtx)!.color).toBe(0x3ba55d);
  });

  it('carries balance and meter label as fields', () => {
    const e = discordAlertEmbed('low-alert', { ...baseCtx, nickname: 'Flat 3B' })!;
    const balance = e.fields!.find(f => f.name === 'Balance')!;
    expect(balance.value).toContain('42.50');
    expect(JSON.stringify(e.fields)).toContain('Flat 3B');
  });

  it('puts the recharge link in the description for actionable alerts', () => {
    expect(discordAlertEmbed('critical-alert', baseCtx)!.description).toContain(
      'prepaid.desco.org.bd'
    );
    // recovery has nothing to act on, so no link
    expect(discordAlertEmbed('recovery', baseCtx)!.description).not.toContain('Recharge now');
  });

  it('differs by tone', () => {
    const savage = discordAlertEmbed('low-alert', baseCtx, 'savage')!;
    const mild = discordAlertEmbed('low-alert', baseCtx, 'mild')!;
    expect(savage.title).not.toBe(mild.title);
  });

  it('adds a run-out field when a prediction is present', () => {
    const prediction: RunOutPrediction = { daysLeft: 3, burnPerDay: 14 };
    const e = discordAlertEmbed('low-alert', { ...baseCtx, prediction })!;
    expect(JSON.stringify(e.fields)).toMatch(/run-out/i);
  });

  it('returns null for none', () => {
    expect(discordAlertEmbed('none', baseCtx)).toBeNull();
  });
});

describe('maskWebhookUrl', () => {
  it('keeps host and id but masks the token', () => {
    expect(maskWebhookUrl(GOOD)).toBe('https://discord.com/api/webhooks/123456789/***');
    expect(maskWebhookUrl('nonsense')).toBe('***');
  });
});
