import { AlertAction } from '../../core/alert-machine';
import { TONES } from '../../core/tone';
import { alertCopy, MeterContext } from '../../notifications/alert-copy';
import { renderAlert } from '../../notifications/telegram-templates';
import { discordAlertEmbed } from '../../notifications/discord-templates';
import { emailAlert } from '../../notifications/email-templates';
import { smsAlertText } from '../../notifications/sms-templates';

const ACTIONS: Exclude<AlertAction, 'none'>[] = [
  'low-alert',
  'critical-alert',
  'reminder',
  'recovery',
];

const ctx: MeterContext = {
  nickname: 'Flat 3B',
  accountNo: '12345678',
  meterNo: '87654321',
  balance: 42.5,
  lowThreshold: 150,
  criticalThreshold: 100,
  prediction: { burnPerDay: 20, daysLeft: 2.1 },
};

describe('alertCopy is the single source of alert wording', () => {
  // The regression this module exists for: the critical title once read "Stone
  // Age Imminent" on Telegram/Discord but "You're About to Live in the Stone
  // Age" in email. Every channel must now carry the same title verbatim.
  describe.each(ACTIONS)('%s', action => {
    it.each(TONES)('renders one title across every channel (%s)', tone => {
      const copy = alertCopy(action, ctx, tone)!;
      expect(copy).not.toBeNull();

      expect(renderAlert(action, ctx, tone)).toContain(copy.title);
      expect(discordAlertEmbed(action, ctx, tone)!.title).toBe(copy.title);
      expect(emailAlert(action, ctx, tone)!.subject).toBe(copy.title);
      expect(smsAlertText(action, ctx, tone)).toBe(copy.sms);
    });
  });

  it('gives the two tones genuinely different words', () => {
    for (const action of ACTIONS) {
      const savage = alertCopy(action, ctx, 'savage')!;
      const mild = alertCopy(action, ctx, 'mild')!;
      expect(savage.title).not.toBe(mild.title);
      expect(savage.body).not.toBe(mild.body);
    }
  });

  it('defaults to savage when no tone is passed', () => {
    for (const action of ACTIONS) {
      expect(alertCopy(action, ctx)).toEqual(alertCopy(action, ctx, 'savage'));
    }
  });

  it('returns null for the no-op action', () => {
    for (const tone of TONES) {
      expect(alertCopy('none', ctx, tone)).toBeNull();
    }
  });

  describe('sms', () => {
    it('is worth a paid segment only for low and critical', () => {
      for (const tone of TONES) {
        expect(alertCopy('low-alert', ctx, tone)!.sms).toBeTruthy();
        expect(alertCopy('critical-alert', ctx, tone)!.sms).toBeTruthy();
        expect(alertCopy('reminder', ctx, tone)!.sms).toBeNull();
        expect(alertCopy('recovery', ctx, tone)!.sms).toBeNull();
      }
    });

    it('stays in one GSM-7 segment even at the worst case', () => {
      // long nickname + a balance wide enough to push the segment
      const worst = { ...ctx, nickname: 'A'.repeat(30), balance: 12345.67 };
      for (const action of ['low-alert', 'critical-alert'] as const) {
        for (const tone of TONES) {
          const sms = alertCopy(action, worst, tone)!.sms!;
          expect(sms.length).toBeLessThanOrEqual(160);
          // a non-GSM char (the taka sign) forces UCS-2 and triples the cost
          expect(/^[\x20-\x7E]*$/.test(sms)).toBe(true);
        }
      }
    });
  });
});
