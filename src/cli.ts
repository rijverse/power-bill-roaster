import { getConfig } from './config';
import { DescoApiClient, EmailService } from './services';
import { generateCriticalEmail, generateWarningEmail } from './templates';
import { logger, maskAccount } from './logger';

// self hosted mode one check, email only, driven entirely by env vars.
// this is the free forever edition fork the repo and run it on your own
// github actions runner (.github/workflows/check balance.yml). the hosted
// saas entry point is src/index.ts.
async function main(): Promise<void> {
  try {
    const config = getConfig();
    const descoApi = new DescoApiClient();
    const emailService = new EmailService(config);

    logger.info(`Checking balance for account: ${maskAccount(config.desco.accountNo)}`);

    const balanceData = await descoApi.getBalance(config.desco.accountNo, config.desco.meterNo);

    const balance = balanceData.balance;
    logger.info(`Current balance: ${balance} BDT`);
    logger.info(`Critical threshold: ${config.thresholds.critical} BDT`);
    logger.info(`Low threshold: ${config.thresholds.low} BDT`);

    // send notifications based on thresholds
    if (balance < config.thresholds.critical) {
      logger.info(`Balance below ${config.thresholds.critical}, sending critical notification...`);
      try {
        const email = generateCriticalEmail(
          balance,
          config.desco.accountNo,
          config.desco.meterNo,
          config.rechargeUrl
        );
        await emailService.send(email);
        logger.info('Critical notification sent');
      } catch (emailError) {
        logger.error('Failed to send critical notification email', emailError);
      }
    } else if (balance < config.thresholds.low) {
      logger.info(`Balance below ${config.thresholds.low}, sending warning notification...`);
      try {
        const email = generateWarningEmail(
          balance,
          config.desco.accountNo,
          config.desco.meterNo,
          config.rechargeUrl
        );
        await emailService.send(email);
        logger.info('Warning notification sent');
      } catch (emailError) {
        logger.error('Failed to send warning notification email', emailError);
      }
    }

    logger.info('Balance check completed successfully');
  } catch (error) {
    logger.error('Error checking balance', error);
    process.exit(1);
  }
}

void main();
