import { normalizeTone } from '../../core/tone';
import { renderAlert, MeterContext } from '../../notifications/telegram-templates';
import { emailAlert } from '../../notifications/email-templates';
import { smsAlertText } from '../../notifications/sms-templates';

const ctx: MeterContext = {
  nickname: null,
  accountNo: '12345678',
  meterNo: '87654321',
  balance: 42.5,
  lowThreshold: 150,
  criticalThreshold: 100,
  prediction: null,
};

describe('normalizeTone', () => {
  it('keeps mild and savage', () => {
    expect(normalizeTone('mild')).toBe('mild');
    expect(normalizeTone('savage')).toBe('savage');
  });
  it('treats legacy "roast" and nullish as savage', () => {
    expect(normalizeTone('roast')).toBe('savage');
    expect(normalizeTone(null)).toBe('savage');
    expect(normalizeTone(undefined)).toBe('savage');
  });
});

describe('tone variants', () => {
  it('telegram: mild differs from savage', () => {
    const savage = renderAlert('critical-alert', ctx, 'savage')!;
    const mild = renderAlert('critical-alert', ctx, 'mild')!;
    expect(savage).not.toEqual(mild);
    expect(savage).toContain('EMERGENCY');
    expect(mild).toContain('critically low');
  });

  it('email: mild softens the subject', () => {
    expect(emailAlert('critical-alert', ctx, 'savage')!.subject).toContain('Stone Age');
    expect(emailAlert('critical-alert', ctx, 'mild')!.subject).not.toContain('Stone Age');
  });

  it('sms: mild differs and stays GSM-safe (no taka sign)', () => {
    const savage = smsAlertText('low-alert', ctx, 'savage')!;
    const mild = smsAlertText('low-alert', ctx, 'mild')!;
    expect(savage).not.toEqual(mild);
    expect(mild).not.toContain('৳');
  });

  it('defaults to savage when tone is omitted', () => {
    expect(renderAlert('low-alert', ctx)).toEqual(renderAlert('low-alert', ctx, 'savage'));
    expect(emailAlert('low-alert', ctx)!.subject).toEqual(
      emailAlert('low-alert', ctx, 'savage')!.subject
    );
  });
});
