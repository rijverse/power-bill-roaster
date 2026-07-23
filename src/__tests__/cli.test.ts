import { main } from '../cli';

// CLI self-hosted mode has zero direct tests; its threshold logic and
// "exit non-zero only on total channel wipeout" semantics are untested.
// These tests stub every external (config, DESCO API, email, Discord) and
// drive main() directly.

jest.mock('../config', () => ({
  getConfig: jest.fn(),
}));
jest.mock('../services', () => ({
  DescoApiClient: jest.fn(),
  EmailService: jest.fn(),
}));
jest.mock('../notifications/discord', () => ({
  sendDiscordAlert: jest.fn(),
  isValidDiscordWebhookUrl: jest.fn(() => true),
}));
jest.mock('../notifications/discord-templates', () => ({
  discordAlertEmbed: jest.fn(),
}));
jest.mock('../notifications/email-templates', () => ({
  emailAlert: jest.fn(),
}));

const { getConfig } = require('../config') as { getConfig: jest.Mock };
const { DescoApiClient, EmailService } = require('../services') as {
  DescoApiClient: jest.Mock;
  EmailService: jest.Mock;
};
const { sendDiscordAlert } = require('../notifications/discord') as {
  sendDiscordAlert: jest.Mock;
};
const { emailAlert } = require('../notifications/email-templates') as { emailAlert: jest.Mock };
const { discordAlertEmbed } = require('../notifications/discord-templates') as {
  discordAlertEmbed: jest.Mock;
};

const mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
  throw new Error(`EXIT_${code ?? 0}`);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockExit.mockImplementation((code?: string | number | null) => {
    throw new Error(`EXIT_${code ?? 0}`);
  });
  DescoApiClient.mockImplementation(() => ({
    getBalance: jest.fn(),
  }));
  EmailService.mockImplementation(() => ({
    send: jest.fn(),
  }));
  emailAlert.mockReturnValue({ subject: 's', text: 't', html: '<p>h</p>' });
  discordAlertEmbed.mockReturnValue({ title: 't' });
});

function setConfig(overrides: Record<string, unknown> = {}) {
  getConfig.mockReturnValue({
    desco: { accountNo: '12345678', meterNo: '87654321' },
    email: null,
    discordWebhookUrl: null,
    thresholds: { low: 150, critical: 100 },
    rechargeUrl: 'https://prepaid.desco.org.bd/',
    tone: 'savage',
    ...overrides,
  });
}

describe('cli main()', () => {
  it('exits 0 and sends nothing when the balance is above thresholds', async () => {
    setConfig();
    DescoApiClient.mockImplementation(() => ({
      getBalance: jest.fn().mockResolvedValue({ balance: 500, currentMonthConsumption: 0 }),
    }));

    await expect(main()).resolves.toBeUndefined();
    expect(sendDiscordAlert).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('sends a critical alert to both email and Discord and exits 0', async () => {
    setConfig({
      email: { to: 'a@b.com', from: 'c@d.com', host: 'h', port: 587, user: 'u', pass: 'p' },
      discordWebhookUrl: 'https://discord.com/api/webhooks/123/token',
    });
    DescoApiClient.mockImplementation(() => ({
      getBalance: jest.fn().mockResolvedValue({ balance: 42, currentMonthConsumption: 0 }),
    }));
    const emailSend = jest.fn().mockResolvedValue(undefined);
    EmailService.mockImplementation(() => ({ send: emailSend }));
    sendDiscordAlert.mockResolvedValue(undefined);

    await expect(main()).resolves.toBeUndefined();
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(sendDiscordAlert).toHaveBeenCalledTimes(1);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('sends a low (not critical) alert when balance is between the two thresholds', async () => {
    setConfig({
      email: { to: 'a@b.com', from: 'c@d.com', host: 'h', port: 587, user: 'u', pass: 'p' },
    });
    DescoApiClient.mockImplementation(() => ({
      getBalance: jest.fn().mockResolvedValue({ balance: 120, currentMonthConsumption: 0 }),
    }));
    const emailSend = jest.fn().mockResolvedValue(undefined);
    EmailService.mockImplementation(() => ({ send: emailSend }));

    await main();
    // 120 < 150 (low) but not < 100 (critical), so it's a low-alert
    expect(emailAlert).toHaveBeenCalledWith('low-alert', expect.anything(), 'savage');
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it('exits 1 when every configured channel fails (total wipeout)', async () => {
    setConfig({
      email: { to: 'a@b.com', from: 'c@d.com', host: 'h', port: 587, user: 'u', pass: 'p' },
    });
    DescoApiClient.mockImplementation(() => ({
      getBalance: jest.fn().mockResolvedValue({ balance: 42, currentMonthConsumption: 0 }),
    }));
    const emailSend = jest.fn().mockRejectedValue(new Error('SMTP down'));
    EmailService.mockImplementation(() => ({ send: emailSend }));

    await expect(main()).rejects.toThrow('EXIT_1');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('exits 0 when at least one channel succeeds despite the other failing', async () => {
    setConfig({
      email: { to: 'a@b.com', from: 'c@d.com', host: 'h', port: 587, user: 'u', pass: 'p' },
      discordWebhookUrl: 'https://discord.com/api/webhooks/123/token',
    });
    DescoApiClient.mockImplementation(() => ({
      getBalance: jest.fn().mockResolvedValue({ balance: 42, currentMonthConsumption: 0 }),
    }));
    const emailSend = jest.fn().mockRejectedValue(new Error('SMTP down'));
    EmailService.mockImplementation(() => ({ send: emailSend }));
    sendDiscordAlert.mockResolvedValue(undefined);

    await expect(main()).resolves.toBeUndefined();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('exits 1 when the DESCO API call itself throws', async () => {
    setConfig();
    DescoApiClient.mockImplementation(() => ({
      getBalance: jest.fn().mockRejectedValue(new Error('DESCO 500')),
    }));

    await expect(main()).rejects.toThrow('EXIT_1');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('honors inverted thresholds per the CLI own classify order', async () => {
    // The CLI checks critical first, then low. With low=50, critical=100,
    // a balance of 80 is below critical -> 'critical-alert' (not 'low-alert').
    setConfig({
      thresholds: { low: 50, critical: 100 },
      email: { to: 'a@b.com', from: 'c@d.com', host: 'h', port: 587, user: 'u', pass: 'p' },
    });
    DescoApiClient.mockImplementation(() => ({
      getBalance: jest.fn().mockResolvedValue({ balance: 80, currentMonthConsumption: 0 }),
    }));
    const emailSend = jest.fn().mockResolvedValue(undefined);
    EmailService.mockImplementation(() => ({ send: emailSend }));

    await main();
    expect(emailAlert).toHaveBeenCalledWith('critical-alert', expect.anything(), 'savage');
  });
});
