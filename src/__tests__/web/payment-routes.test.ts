import http from 'http';
import { AddressInfo } from 'net';
import { createWebServer } from '../../web/server';
import { Scheduler } from '../../core/scheduler';
import { SubscriptionService } from '../../billing';
import { Db } from '../../db';
import { ServerConfig } from '../../config';

// Exercises only the /pay/* routes, so db is never touched and the scheduler is
// a stub. SubscriptionService is faked to assert what the routes hand it.
function startServer(finalizePending: jest.Mock) {
  const subscriptions = { finalizePending } as unknown as SubscriptionService;
  const scheduler = { lastCycleCompletedAt: new Date() } as unknown as Scheduler;
  const config = { port: 0, pollIntervalHours: 6 } as ServerConfig;
  const server = createWebServer({} as Db, scheduler, config, subscriptions);
  return new Promise<{ server: http.Server; base: string }>(resolve => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function get(base: string, path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.text() };
}

async function postForm(base: string, path: string, form: Record<string, string>) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  return { status: res.status, body: await res.text() };
}

describe('payment callback routes', () => {
  let server: http.Server;
  let base: string;
  let finalize: jest.Mock;

  beforeEach(async () => {
    finalize = jest.fn().mockResolvedValue({ status: 'paid', activated: true });
    ({ server, base } = await startServer(finalize));
  });

  afterEach(() => {
    server.close();
  });

  it('bKash success finalizes by paymentID and shows the confirmed page', async () => {
    const { status, body } = await get(base, '/pay/bkash/callback?status=success&paymentID=PID123');
    expect(status).toBe(200);
    expect(body).toContain('Payment confirmed');
    expect(finalize).toHaveBeenCalledWith('PID123');
  });

  it('bKash non-success never calls finalize', async () => {
    const { status, body } = await get(base, '/pay/bkash/callback?status=cancel&paymentID=PID123');
    expect(status).toBe(200);
    expect(body).toContain('Payment cancelled');
    expect(finalize).not.toHaveBeenCalled();
  });

  it('bKash success without paymentID is a 400, no finalize', async () => {
    const { status, body } = await get(base, '/pay/bkash/callback?status=success');
    expect(status).toBe(400);
    expect(body).toContain('reference missing');
    expect(finalize).not.toHaveBeenCalled();
  });

  it('SSLCommerz success POST finalizes by tran_id from the form body', async () => {
    const { status, body } = await postForm(base, '/pay/sslcommerz/success', {
      tran_id: 'u3-business-1',
      val_id: 'V1',
    });
    expect(status).toBe(200);
    expect(body).toContain('Payment confirmed');
    expect(finalize).toHaveBeenCalledWith('u3-business-1');
  });

  it('SSLCommerz IPN finalizes and acks with JSON', async () => {
    const { status, body } = await postForm(base, '/pay/sslcommerz/ipn', { tran_id: 'ref-9' });
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ received: true });
    expect(finalize).toHaveBeenCalledWith('ref-9');
  });

  it('SSLCommerz fail/cancel never call finalize', async () => {
    await get(base, '/pay/sslcommerz/fail');
    await get(base, '/pay/sslcommerz/cancel');
    expect(finalize).not.toHaveBeenCalled();
  });

  it('renders the processing page when the gateway is not done yet', async () => {
    finalize.mockResolvedValueOnce({ status: 'pending', activated: false });
    const { body } = await get(base, '/pay/bkash/callback?status=success&paymentID=P');
    expect(body).toContain('Payment processing');
  });
});
