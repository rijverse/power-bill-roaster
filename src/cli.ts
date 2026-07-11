import { getConfig } from './config';
import { DescoApiClient, EmailService } from './services';
import { sendDiscordAlert } from './notifications/discord';
import { discordAlertEmbed } from './notifications/discord-templates';
import { emailAlert } from './notifications/email-templates';
import { MeterContext } from './notifications/alert-copy';
import { logger, maskAccount, maskWebhookUrl } from './logger';

// self hosted mode: one balance check, fanned out to every configured channel
// (email and/or Discord), driven entirely by env vars. this is the free-forever
// edition - fork the repo and run it on your own github actions runner
// (.github/workflows/check-balance.yml). the hosted saas entry point is
// src/index.ts.

interface Channel {
  label: string;
  send: () => Promise<void>;
}

// Wrap a channel so one channel's failure never skips the others (same isolation
// philosophy as the hosted dispatcher). Returns whether it delivered.
async function deliver(channel: Channel): Promise<boolean> {
  try {
    await channel.send();
    logger.info(`Alert delivered via ${channel.label}`);
    return true;
  } catch (error) {
    logger.error(
      `Alert failed via ${channel.label}`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

async function main(): Promise<void> {
  try {
    const config = getConfig();
    const descoApi = new DescoApiClient();

    logger.info(`Checking balance for account: ${maskAccount(config.desco.accountNo)}`);

    const balanceData = await descoApi.getBalance(config.desco.accountNo, config.desco.meterNo);
    const balance = balanceData.balance;
    logger.info(`Current balance: ${balance} BDT`);
    logger.info(`Critical threshold: ${config.thresholds.critical} BDT`);
    logger.info(`Low threshold: ${config.thresholds.low} BDT`);

    const action =
      balance < config.thresholds.critical
        ? 'critical-alert'
        : balance < config.thresholds.low
          ? 'low-alert'
          : 'none';

    if (action === 'none') {
      logger.info('Balance is above thresholds - nothing to send');
      logger.info('Balance check completed successfully');
      return;
    }

    logger.info(`Balance triggered a ${action}, notifying every configured channel...`);

    const ctx: MeterContext = {
      nickname: null,
      accountNo: config.desco.accountNo,
      meterNo: config.desco.meterNo,
      balance,
      lowThreshold: config.thresholds.low,
      criticalThreshold: config.thresholds.critical,
      rechargeUrl: config.rechargeUrl,
    };

    const channels: Channel[] = [];
    if (config.email) {
      const email = config.email;
      channels.push({
        label: 'email',
        send: async () => {
          const content = emailAlert(action, ctx, config.tone);
          if (content) {
            await new EmailService(email).send(content);
          }
        },
      });
    }
    if (config.discordWebhookUrl) {
      const webhookUrl = config.discordWebhookUrl;
      channels.push({
        label: `Discord (${maskWebhookUrl(webhookUrl)})`,
        send: async () => {
          const embed = discordAlertEmbed(action, ctx, config.tone);
          if (embed) {
            await sendDiscordAlert(webhookUrl, embed);
          }
        },
      });
    }

    const results = await Promise.all(channels.map(deliver));
    // Only a total wipeout is a run failure - GitHub emails the fork owner on a
    // non-zero exit, and one flaky SMTP day shouldn't mask a delivered Discord
    // alert (or vice versa).
    if (!results.some(Boolean)) {
      logger.error('Every configured alert channel failed');
      process.exit(1);
    }

    logger.info('Balance check completed successfully');
  } catch (error) {
    logger.error('Error checking balance', error);
    process.exit(1);
  }
}

void main();
