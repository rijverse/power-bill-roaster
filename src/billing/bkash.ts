import { fetchWithTimeout } from '../core/http';
import { logger } from '../logger';
import { CheckoutSession, PaymentProvider, PaymentStatus } from './types';

export interface BkashConfig {
  appKey: string;
  appSecret: string;
  username: string;
  password: string;
  baseUrl: string; // sandbox: https://tokenized.sandbox.bka.sh/v1.2.0-beta
  /** where bKash redirects the payer back to after authorization */
  callbackUrl: string;
}

interface GrantTokenResponse {
  id_token?: string;
  expires_in?: number;
  statusCode?: string;
  statusMessage?: string;
}

interface CreateResponse {
  paymentID?: string;
  bkashURL?: string;
  statusCode?: string;
  statusMessage?: string;
}

interface ExecuteResponse {
  statusCode?: string;
  transactionStatus?: string;
  trxID?: string;
}

interface StatusResponse {
  statusCode?: string;
  transactionStatus?: string;
}

const SUCCESS = '0000';
// bKash issues short-lived tokens (~1h); refresh a minute early to avoid races.
const TOKEN_SKEW_MS = 60 * 1000;

/**
 * bKash Tokenized Checkout.
 *   1. POST /tokenized/checkout/token/grant  (appKey+secret -> id_token, cached)
 *   2. POST /tokenized/checkout/create       (amount, invoice -> paymentID, bkashURL)
 *   3. user authorizes at bkashURL; bKash redirects to callbackUrl?paymentID=&status=
 *   4. POST /tokenized/checkout/execute      (paymentID -> captures funds)
 *      falling back to /payment/status when execute can't run (already executed,
 *      or queried before authorization).
 * Docs: https://developer.bka.sh
 */
export class BkashProvider implements PaymentProvider {
  readonly name = 'bkash';
  readonly autoConfirms = false;

  private token: { value: string; expiresAt: number } | null = null;

  constructor(private config: BkashConfig) {}

  async createCheckout(opts: {
    userId: number;
    plan: string;
    amountBdt: number;
    reference: string;
  }): Promise<CheckoutSession> {
    const body: CreateResponse = await this.authedPost('/tokenized/checkout/create', {
      mode: '0011',
      payerReference: `u${opts.userId}`,
      callbackURL: this.config.callbackUrl,
      amount: opts.amountBdt.toString(),
      currency: 'BDT',
      intent: 'sale',
      merchantInvoiceNumber: opts.reference,
    });
    if (!body.paymentID || !body.bkashURL) {
      throw new Error(
        `bKash create failed: ${body.statusCode ?? '?'} ${body.statusMessage ?? JSON.stringify(body)}`
      );
    }
    return { externalRef: body.paymentID, paymentUrl: body.bkashURL };
  }

  async verifyPayment(paymentId: string): Promise<PaymentStatus> {
    // Execute captures the funds; it only succeeds once and only after the payer
    // authorizes, so a non-completed result falls through to a status query.
    let execStatus: string | undefined;
    try {
      const exec: ExecuteResponse = await this.authedPost('/tokenized/checkout/execute', {
        paymentID: paymentId,
      });
      if (exec.statusCode === SUCCESS && exec.transactionStatus === 'Completed') {
        return 'paid';
      }
      execStatus = exec.transactionStatus;
    } catch (error) {
      logger.error('bKash execute failed, falling back to status query', error);
    }

    const status: StatusResponse = await this.authedPost('/tokenized/checkout/payment/status', {
      paymentID: paymentId,
    });
    return mapBkashStatus(status.transactionStatus ?? execStatus);
  }

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - TOKEN_SKEW_MS) {
      return this.token.value;
    }
    const res = await fetchWithTimeout(`${this.config.baseUrl}/tokenized/checkout/token/grant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        username: this.config.username,
        password: this.config.password,
      },
      body: JSON.stringify({ app_key: this.config.appKey, app_secret: this.config.appSecret }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`bKash token grant returned ${res.status}: ${text.slice(0, 200)}`);
    }
    const body = (await res.json()) as GrantTokenResponse;
    if (!body.id_token) {
      throw new Error(`bKash token grant failed: ${body.statusMessage ?? JSON.stringify(body)}`);
    }
    this.token = {
      value: body.id_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  private async authedPost<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    const token = await this.ensureToken();
    const res = await fetchWithTimeout(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: token,
        'X-APP-Key': this.config.appKey,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`bKash ${path} returned ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}

export function mapBkashStatus(transactionStatus: string | undefined): PaymentStatus {
  switch (transactionStatus) {
    case 'Completed':
      return 'paid';
    case 'Initiated':
    case 'Authorized':
      return 'pending';
    default:
      return 'failed';
  }
}
