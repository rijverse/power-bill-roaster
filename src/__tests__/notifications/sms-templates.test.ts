import { smsAlertText } from '../../notifications/sms-templates';
import { MeterContext } from '../../notifications/telegram-templates';

const baseCtx: MeterContext = {
  nickname: null,
  accountNo: '12345678',
  meterNo: '87654321',
  balance: 42.5,
  lowThreshold: 150,
  criticalThreshold: 100,
};

describe('smsAlertText', () => {
  it('renders low and critical alerts', () => {
    expect(smsAlertText('low-alert', baseCtx)).toContain('LOW');
    expect(smsAlertText('critical-alert', baseCtx)).toContain('CRITICAL');
    expect(smsAlertText('low-alert', baseCtx)).toContain('Tk42.50');
  });

  it('uses the nickname when set', () => {
    const named = { ...baseCtx, nickname: 'Flat 3B' };
    expect(smsAlertText('critical-alert', named)).toContain('Flat 3B');
  });

  it('sends nothing for reminders, recovery, and none', () => {
    expect(smsAlertText('reminder', baseCtx)).toBeNull();
    expect(smsAlertText('recovery', baseCtx)).toBeNull();
    expect(smsAlertText('none', baseCtx)).toBeNull();
  });

  it('stays within one GSM-7 segment (160 chars, ASCII only)', () => {
    const longNickname = { ...baseCtx, nickname: 'A'.repeat(30), balance: 12345.67 };
    for (const action of ['low-alert', 'critical-alert'] as const) {
      const text = smsAlertText(action, longNickname)!;
      expect(text.length).toBeLessThanOrEqual(160);
      // non-ASCII (like the taka sign) would force UCS-2 and triple the cost
      expect(/^[\x20-\x7E]*$/.test(text)).toBe(true);
    }
  });
});
