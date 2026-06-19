import { emailAlert } from '../../notifications/email-templates';
import { MeterContext } from '../../notifications/telegram-templates';

const ctx: MeterContext = {
  nickname: 'Flat 3B',
  accountNo: '12345678',
  meterNo: '87654321',
  balance: 42.5,
  lowThreshold: 150,
  criticalThreshold: 100,
  prediction: { burnPerDay: 20, daysLeft: 2.1 },
};

describe('emailAlert', () => {
  it('renders a low alert with balance, threshold, and prediction', () => {
    const email = emailAlert('low-alert', ctx)!;
    expect(email).not.toBeNull();
    expect(email.subject).toContain('Ghost');
    expect(email.text).toContain('৳42.50');
    expect(email.text).toContain('150');
    expect(email.html).toContain('Flat 3B'); // nickname in the footer
    expect(email.text).toContain('2'); // prediction days
  });

  it('renders a critical alert', () => {
    const email = emailAlert('critical-alert', ctx)!;
    expect(email.subject).toContain('EMERGENCY');
    expect(email.html).toContain('Power Emergency');
  });

  it('renders reminder and recovery (email is free, so both are sent)', () => {
    expect(emailAlert('reminder', ctx)?.subject).toContain('Still Low');
    expect(emailAlert('recovery', ctx)?.subject).toContain('Money Works');
  });

  it('returns null for the no-op action', () => {
    expect(emailAlert('none', ctx)).toBeNull();
  });

  it('omits the prediction line when there is no prediction', () => {
    const email = emailAlert('low-alert', { ...ctx, prediction: null })!;
    expect(email.text).not.toContain('/day');
  });
});
