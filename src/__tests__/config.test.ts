// mock dotenv before importing config
jest.mock('dotenv/config', () => ({}));

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    // clear all env vars for clean slate
    process.env = {};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validateEnv', () => {
    it('should throw error when required env vars are missing', () => {
      // import fresh module with empty env
      jest.isolateModules(() => {
        jest.mock('dotenv/config', () => ({}));
        const { validateEnv } = require('../config');
        expect(() => validateEnv()).toThrow('Missing required environment variables');
      });
    });

    it('should not throw when all required env vars are present', () => {
      process.env.DESCO_ACCOUNT_NO = '123';
      process.env.DESCO_METER_NO = '456';
      process.env.EMAIL_TO = 'test@example.com';
      process.env.EMAIL_FROM = 'from@example.com';
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'user';
      process.env.SMTP_PASS = 'pass';

      jest.isolateModules(() => {
        jest.mock('dotenv/config', () => ({}));
        const { validateEnv } = require('../config');
        expect(() => validateEnv()).not.toThrow();
      });
    });
  });

  describe('getConfig', () => {
    beforeEach(() => {
      process.env.DESCO_ACCOUNT_NO = '13151091';
      process.env.DESCO_METER_NO = '661120227647';
      process.env.EMAIL_TO = 'test@example.com';
      process.env.EMAIL_FROM = 'from@example.com';
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'user';
      process.env.SMTP_PASS = 'pass';
    });

    it('should return correct config object', () => {
      jest.isolateModules(() => {
        jest.mock('dotenv/config', () => ({}));
        const { getConfig } = require('../config');
        const config = getConfig();

        expect(config.desco.accountNo).toBe('13151091');
        expect(config.desco.meterNo).toBe('661120227647');
        expect(config.email.to).toBe('test@example.com');
        expect(config.email.host).toBe('smtp.test.com');
      });
    });

    it('should use default thresholds', () => {
      jest.isolateModules(() => {
        jest.mock('dotenv/config', () => ({}));
        const { getConfig } = require('../config');
        const config = getConfig();

        expect(config.thresholds.low).toBe(150);
        expect(config.thresholds.critical).toBe(100);
      });
    });

    it('should use custom thresholds from environment', () => {
      process.env.LOW_THRESHOLD = '200';
      process.env.CRITICAL_THRESHOLD = '50';

      jest.isolateModules(() => {
        jest.mock('dotenv/config', () => ({}));
        const { getConfig } = require('../config');
        const config = getConfig();

        expect(config.thresholds.low).toBe(200);
        expect(config.thresholds.critical).toBe(50);
      });
    });

    it('should use default SMTP port', () => {
      jest.isolateModules(() => {
        jest.mock('dotenv/config', () => ({}));
        const { getConfig } = require('../config');
        const config = getConfig();

        expect(config.email.port).toBe(587);
      });
    });

    it('should use custom SMTP port from environment', () => {
      process.env.SMTP_PORT = '465';

      jest.isolateModules(() => {
        jest.mock('dotenv/config', () => ({}));
        const { getConfig } = require('../config');
        const config = getConfig();

        expect(config.email.port).toBe(465);
      });
    });
  });

  describe('validateEnv alert channels', () => {
    const GOOD_WEBHOOK = 'https://discord.com/api/webhooks/123456789/abc-token';

    beforeEach(() => {
      process.env.DESCO_ACCOUNT_NO = '13151091';
      process.env.DESCO_METER_NO = '661120227647';
    });

    const setEmail = () => {
      process.env.EMAIL_TO = 'test@example.com';
      process.env.EMAIL_FROM = 'from@example.com';
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'user';
      process.env.SMTP_PASS = 'pass';
    };

    it('accepts an email-only channel', () => {
      setEmail();
      jest.isolateModules(() => {
        jest.mock('dotenv/config', () => ({}));
        const { getConfig } = require('../config');
        const config = getConfig();
        expect(config.email).not.toBeNull();
        expect(config.discordWebhookUrl).toBeNull();
      });
    });

    it('accepts a discord-only channel (no SMTP)', () => {
      process.env.DISCORD_WEBHOOK_URL = GOOD_WEBHOOK;
      jest.isolateModules(() => {
        jest.mock('dotenv/config', () => ({}));
        const { getConfig } = require('../config');
        const config = getConfig();
        expect(config.email).toBeNull();
        expect(config.discordWebhookUrl).toBe(GOOD_WEBHOOK);
      });
    });

    it('accepts both channels together', () => {
      setEmail();
      process.env.DISCORD_WEBHOOK_URL = GOOD_WEBHOOK;
      jest.isolateModules(() => {
        jest.mock('dotenv/config', () => ({}));
        const { getConfig } = require('../config');
        const config = getConfig();
        expect(config.email).not.toBeNull();
        expect(config.discordWebhookUrl).toBe(GOOD_WEBHOOK);
      });
    });

    it('rejects zero channels with guidance', () => {
      jest.isolateModules(() => {
        jest.mock('dotenv/config', () => ({}));
        const { validateEnv } = require('../config');
        expect(() => validateEnv()).toThrow('at least one alert channel');
      });
    });

    it('rejects a partial SMTP block, naming the missing keys', () => {
      process.env.EMAIL_TO = 'test@example.com';
      process.env.EMAIL_FROM = 'from@example.com';
      process.env.SMTP_HOST = 'smtp.test.com';
      // SMTP_USER and SMTP_PASS intentionally unset
      jest.isolateModules(() => {
        jest.mock('dotenv/config', () => ({}));
        const { validateEnv } = require('../config');
        expect(() => validateEnv()).toThrow('SMTP_USER');
        expect(() => validateEnv()).toThrow('SMTP_PASS');
      });
    });

    it('rejects an invalid Discord webhook URL', () => {
      process.env.DISCORD_WEBHOOK_URL = 'https://evil.com/hook';
      jest.isolateModules(() => {
        jest.mock('dotenv/config', () => ({}));
        const { validateEnv } = require('../config');
        expect(() => validateEnv()).toThrow('not a valid Discord webhook');
      });
    });
  });

  describe('getServerConfig billing', () => {
    beforeEach(() => {
      process.env.DATABASE_URL = 'postgres://localhost/test';
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    });

    it('defaults to none so a fresh deploy never auto-approves upgrades', () => {
      jest.isolateModules(() => {
        jest.mock('dotenv/config', () => ({}));
        const { getServerConfig } = require('../config');
        expect(getServerConfig().billing.provider).toBe('none');
      });
    });

    it('honors an explicit BILLING_PROVIDER=sandbox for dev', () => {
      process.env.BILLING_PROVIDER = 'sandbox';
      jest.isolateModules(() => {
        jest.mock('dotenv/config', () => ({}));
        const { getServerConfig } = require('../config');
        expect(getServerConfig().billing.provider).toBe('sandbox');
      });
    });
  });
});
