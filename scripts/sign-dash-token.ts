// Dev utility: prints a dashboard token for a user id, signed the same way
// the server signs them. Usage: npx tsx scripts/sign-dash-token.ts [userId]
import 'dotenv/config';
import crypto from 'crypto';
import { signDashboardToken } from '../src/web/token';

const userId = parseInt(process.argv[2] || '1');
const secret =
  process.env.DASHBOARD_SECRET ||
  crypto.createHash('sha256').update(`dash:${process.env.TELEGRAM_BOT_TOKEN}`).digest('hex');
console.log(signDashboardToken(userId, Date.now() + 24 * 60 * 60 * 1000, secret));
