// Roast intensity. "savage" is the original Power·Roast voice; "mild" is the
// gentler, just-the-facts variant. Stored per-user in users.tone_pref and chosen
// from the customer web app's Alerts screen. Legacy rows store 'roast' — treated
// as savage.

export type Tone = 'savage' | 'mild';

export const TONES: Tone[] = ['savage', 'mild'];

export function normalizeTone(pref: string | null | undefined): Tone {
  return pref === 'mild' ? 'mild' : 'savage';
}
