import { classify, evaluate, AlertStateSnapshot, Thresholds } from '../../core/alert-machine';

const thresholds: Thresholds = { low: 150, critical: 100 };
const REMINDER_MS = 24 * 60 * 60 * 1000;
const now = new Date('2026-06-12T12:00:00Z');

function state(overrides: Partial<AlertStateSnapshot> = {}): AlertStateSnapshot {
  return { level: 'ok', lastAlertAt: null, lastBalance: null, ...overrides };
}

describe('classify', () => {
  it('returns ok at or above the low threshold', () => {
    expect(classify(150, thresholds)).toBe('ok');
    expect(classify(500, thresholds)).toBe('ok');
  });

  it('returns low between critical and low thresholds', () => {
    expect(classify(149.99, thresholds)).toBe('low');
    expect(classify(100, thresholds)).toBe('low');
  });

  it('returns critical below the critical threshold', () => {
    expect(classify(99.99, thresholds)).toBe('critical');
    expect(classify(0, thresholds)).toBe('critical');
  });
});

describe('evaluate', () => {
  it('does nothing while balance stays ok', () => {
    const decision = evaluate(state({ lastBalance: 300 }), 250, thresholds, now, REMINDER_MS);
    expect(decision).toEqual({ level: 'ok', action: 'none', rechargeDetected: false });
  });

  it('fires low-alert on ok→low crossing', () => {
    const decision = evaluate(state({ lastBalance: 200 }), 140, thresholds, now, REMINDER_MS);
    expect(decision.action).toBe('low-alert');
    expect(decision.level).toBe('low');
  });

  it('fires critical-alert on ok→critical crossing (fast drain)', () => {
    const decision = evaluate(state({ lastBalance: 200 }), 50, thresholds, now, REMINDER_MS);
    expect(decision.action).toBe('critical-alert');
  });

  it('fires critical-alert on low→critical escalation', () => {
    const prev = state({ level: 'low', lastAlertAt: now, lastBalance: 120 });
    const decision = evaluate(prev, 80, thresholds, now, REMINDER_MS);
    expect(decision.action).toBe('critical-alert');
  });

  it('does NOT re-alert while balance sits under a threshold', () => {
    const recentAlert = new Date(now.getTime() - 60 * 60 * 1000); // 1h ago
    const prev = state({ level: 'low', lastAlertAt: recentAlert, lastBalance: 140 });
    const decision = evaluate(prev, 130, thresholds, now, REMINDER_MS);
    expect(decision.action).toBe('none');
  });

  it('sends a reminder after the reminder interval elapses', () => {
    const staleAlert = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25h ago
    const prev = state({ level: 'low', lastAlertAt: staleAlert, lastBalance: 140 });
    const decision = evaluate(prev, 130, thresholds, now, REMINDER_MS);
    expect(decision.action).toBe('reminder');
  });

  it('does not remind when the level improved from critical to low', () => {
    const staleAlert = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const prev = state({ level: 'critical', lastAlertAt: staleAlert, lastBalance: 50 });
    const decision = evaluate(prev, 120, thresholds, now, REMINDER_MS);
    // partial recharge better, but still low stay quiet rather than nag
    expect(decision.action).toBe('none');
    expect(decision.level).toBe('low');
    expect(decision.rechargeDetected).toBe(true);
  });

  it('fires recovery when balance returns to ok after an alert', () => {
    const prev = state({ level: 'critical', lastAlertAt: now, lastBalance: 50 });
    const decision = evaluate(prev, 500, thresholds, now, REMINDER_MS);
    expect(decision.action).toBe('recovery');
    expect(decision.rechargeDetected).toBe(true);
  });

  it('detects recharge only above the noise epsilon', () => {
    const prev = state({ level: 'low', lastAlertAt: now, lastBalance: 130 });
    const noisy = evaluate(prev, 130.5, thresholds, now, REMINDER_MS);
    expect(noisy.rechargeDetected).toBe(false);

    const real = evaluate(prev, 145, thresholds, now, REMINDER_MS);
    expect(real.rechargeDetected).toBe(true);
  });

  it('handles first-ever reading (no prior balance) without false recharge', () => {
    const decision = evaluate(state(), 80, thresholds, now, REMINDER_MS);
    expect(decision.action).toBe('critical-alert');
    expect(decision.rechargeDetected).toBe(false);
  });
});
