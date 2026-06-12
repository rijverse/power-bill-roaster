/**
 * Normalizes a Bangladeshi mobile number to 8801XXXXXXXXX, or null if it
 * isn't one. Accepts +880..., 880..., and 01... forms with optional
 * spaces/dashes. BD mobiles are 01[3-9] + 8 digits.
 */
export function normalizeBdPhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, '');
  const match = /^(?:\+?880|0)(1[3-9]\d{8})$/.exec(digits);
  return match ? `880${match[1]}` : null;
}
