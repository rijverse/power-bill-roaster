import { getConfig } from './config';
import { DescoApiClient, EmailService } from './services';
import { generateCriticalEmail, generateWarningEmail } from './templates';

// self hosted mode one check, email only, driven entirely by env vars.
// this is the free forever edition fork the repo and run it on your own
// github actions runner (.github/workflows/check balance.yml). the hosted
// saas entry point is src/index.ts.
async function main(): Promise<void> {
  try {
    const config = getConfig();
    const descoApi = new DescoApiClient();
    const emailService = new EmailService(config);

    console.log('Checking balance for account:', config.desco.accountNo);

    const balanceData = await descoApi.getBalance(config.desco.accountNo, config.desco.meterNo);

    const balance = balanceData.balance;
    console.log('Current balance:', balance, 'BDT');
    console.log('Critical threshold:', config.thresholds.critical, 'BDT');
    console.log('Low threshold:', config.thresholds.low, 'BDT');

    // send notifications based on thresholds
    if (balance < config.thresholds.critical) {
      console.log(`Balance below ${config.thresholds.critical}, sending critical notification...`);
      try {
        const email = generateCriticalEmail(balance, config.desco.accountNo, config.desco.meterNo);
        await emailService.send(email);
        console.log('Critical notification sent');
      } catch (emailError) {
        console.error('Failed to send critical notification email:', emailError);
      }
    } else if (balance < config.thresholds.low) {
      console.log(`Balance below ${config.thresholds.low}, sending warning notification...`);
      try {
        const email = generateWarningEmail(balance, config.desco.accountNo, config.desco.meterNo);
        await emailService.send(email);
        console.log('Warning notification sent');
      } catch (emailError) {
        console.error('Failed to send warning notification email:', emailError);
      }
    }

    console.log('Balance check completed successfully');
  } catch (error) {
    console.error('Error checking balance:', error);
    process.exit(1);
  }
}

void main();
