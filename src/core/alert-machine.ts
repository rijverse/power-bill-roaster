export type AlertLevel = 'ok' | 'low' | 'critical';

export type AlertAction = 'none' | 'low-alert' | 'critical-alert' | 'reminder' | 'recovery';

export interface AlertStateSnapshot {
  level: AlertLevel;
  lastAlertAt: Date | null;
  lastBalance: number | null;
  /** Set when the user snoozed reminders from an alert button; holds back the
   *  repeat nag until it passes. Absent/null means not snoozed. */
  remindersSnoozedUntil?: Date | null;
}

export interface Thresholds {
  low: number;
  critical: number;
}

export interface AlertDecision {
  level: AlertLevel;
  action: AlertAction;
  rechargeDetected: boolean;
}

// balance noise (meter clock drift, rounding) stays well under this a real
// recharge in bdt is always larger.
const RECHARGE_EPSILON = 1;

const SEVERITY: Record<AlertLevel, number> = { ok: 0, low: 1, critical: 2 };

export function classify(balance: number, thresholds: Thresholds): AlertLevel {
  if (balance < thresholds.critical) {
    return 'critical';
  }
  if (balance < thresholds.low) {
    return 'low';
  }
  return 'ok';
}

/**
 * decides what (if anything) to send for a new balance reading.
 *
 * alerts fire on threshold *crossings* (ok→low, low→critical, ok→critical),
 * never repeatedly while the balance sits under a threshold. while low, a
 * reminder fires at most once per reminderintervalms. when the balance
 * climbs back to ok from an alerted state, a single recovery message fires.
 */
export function evaluate(
  prev: AlertStateSnapshot,
  balance: number,
  thresholds: Thresholds,
  now: Date,
  reminderIntervalMs: number
): AlertDecision {
  const level = classify(balance, thresholds);
  const rechargeDetected =
    prev.lastBalance !== null && balance > prev.lastBalance + RECHARGE_EPSILON;

  if (SEVERITY[level] > SEVERITY[prev.level]) {
    return {
      level,
      action: level === 'critical' ? 'critical-alert' : 'low-alert',
      rechargeDetected,
    };
  }

  if (level === 'ok' && prev.level !== 'ok') {
    return { level, action: 'recovery', rechargeDetected };
  }

  if (
    level !== 'ok' &&
    level === prev.level &&
    prev.lastAlertAt !== null &&
    now.getTime() - prev.lastAlertAt.getTime() >= reminderIntervalMs
  ) {
    // a reminder is due - unless the user snoozed it from an alert button.
    // snooze only mutes the repeat nag; the escalation and recovery branches
    // above deliberately ignore it.
    const snoozed =
      prev.remindersSnoozedUntil != null && now.getTime() < prev.remindersSnoozedUntil.getTime();
    return { level, action: snoozed ? 'none' : 'reminder', rechargeDetected };
  }

  return { level, action: 'none', rechargeDetected };
}
