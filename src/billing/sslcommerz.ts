import { fetchWithTimeout } from '../core/http';
import { CheckoutSession, PaymentProvider, PaymentStatus } from './types';

export interface SslcommerzConfig {
  storeId: string;
  storePassword: string;
  baseUrl: string; // sandbox: https://sandbox.sslcommerz.com
  /** our public origin; the four redirect/IPN URLs are derived from it */
  publicBaseUrl: string;
}

interface SessionResponse {
  status?: string; // SUCCESS | FAILED
  sessionkey?: string;
  GatewayPageURL?: string;
  failedreason?: string;
}

interface ValidationResponse {
  APIConnect?: string;
  no_of_trans_found?: number;
  element?: { status?: string; tran_id?: string }[];
}

/**
 * SSLCommerz hosted checkout.
 *   1. POST /gwprocess/v4/api.php  (store creds, amount, tran_id -> GatewayPageURL)
 *   2. user pays; SSLCommerz redirects to success/fail/cancel and POSTs the IPN
 *   3. GET /validator/api/merchantTransIDvalidationAPI.php?tran_id=...
 *      -> element[].status VALID/VALIDATED. We key on tran_id (our reference) so
 *      verifyPayment needs nothing from the untrusted callback body.
 * Docs: https://developer.sslcommerz.com
 */
export class SslcommerzProvider implements PaymentProvider {
  readonly name = 'sslcommerz';
  readonly autoConfirms = false;

  constructor(private config: SslcommerzConfig) {}

  async createCheckout(opts: {
    userId: number;
    plan: string;
    amountBdt: number;
    reference: string;
  }): Promise<CheckoutSession> {
    const base = this.config.publicBaseUrl;
    const form = new URLSearchParams({
      store_id: this.config.storeId,
      store_passwd: this.config.storePassword,
      total_amount: opts.amountBdt.toString(),
      currency: 'BDT',
      tran_id: opts.reference,
      success_url: `${base}/pay/sslcommerz/success`,
      fail_url: `${base}/pay/sslcommerz/fail`,
      cancel_url: `${base}/pay/sslcommerz/cancel`,
      ipn_url: `${base}/pay/sslcommerz/ipn`,
      product_name: `Power Roast ${opts.plan}`,
      product_category: 'subscription',
      product_profile: 'non-physical-goods',
      cus_name: `user-${opts.userId}`,
      cus_email: 'billing@powerroast.app',
      cus_add1: 'N/A',
      cus_city: 'Dhaka',
      cus_country: 'Bangladesh',
      cus_phone: 'N/A',
      shipping_method: 'NO',
      num_of_item: '1',
    });

    const res = await fetchWithTimeout(`${this.config.baseUrl}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const body = (await res.json()) as SessionResponse;
    if (body.status !== 'SUCCESS' || !body.GatewayPageURL) {
      throw new Error(`SSLCommerz session failed: ${body.failedreason ?? JSON.stringify(body)}`);
    }
    return { externalRef: opts.reference, paymentUrl: body.GatewayPageURL };
  }

  async verifyPayment(tranId: string): Promise<PaymentStatus> {
    const url =
      `${this.config.baseUrl}/validator/api/merchantTransIDvalidationAPI.php` +
      `?tran_id=${encodeURIComponent(tranId)}` +
      `&store_id=${encodeURIComponent(this.config.storeId)}` +
      `&store_passwd=${encodeURIComponent(this.config.storePassword)}` +
      `&v=1&format=json`;
    const res = await fetchWithTimeout(url);
    const body = (await res.json()) as ValidationResponse;
    const status = body.element?.[0]?.status;
    return mapSslcommerzStatus(status);
  }
}

export function mapSslcommerzStatus(status: string | undefined): PaymentStatus {
  switch (status) {
    case 'VALID':
    case 'VALIDATED':
      return 'paid';
    case 'PENDING':
    case 'UNATTEMPTED':
    case undefined: // no transaction recorded yet (e.g. verified right after create)
      return 'pending';
    default: // FAILED | CANCELLED | EXPIRED | INVALID_TRANSACTION
      return 'failed';
  }
}
