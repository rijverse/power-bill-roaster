import { predictRunOut, formatDaysLeft, ReadingPoint } from '../../core/prediction';

const HOUR = 60 * 60 * 1000;
const t0 = new Date('2026-06-10T00:00:00Z').getTime();

function series(points: Array<[number, number]>): ReadingPoint[] {
  return points.map(([hoursAfterT0, balance]) => ({
    balance,
    at: new Date(t0 + hoursAfterT0 * HOUR),
  }));
}

describe('predictRunOut', () => {
  it('computes burn rate from a steady decline', () => {
    // 10 BDT every 6h = 40/day, balance 200 -> 5 days
    const readings = series([
      [0, 230],
      [6, 220],
      [12, 210],
      [18, 200],
    ]);
    const p = predictRunOut(readings, 200);
    expect(p).not.toBeNull();
    expect(p!.burnPerDay).toBeCloseTo(40, 5);
    expect(p!.daysLeft).toBeCloseTo(5, 5);
  });

  it('skips recharge jumps instead of diluting the burn rate', () => {
    // declining at 40/day, with a 500 BDT recharge in the middle
    const readings = series([
      [0, 100],
      [6, 90],
      [12, 590], // recharge - this pair must be ignored
      [18, 580],
      [24, 570],
    ]);
    const p = predictRunOut(readings, 570);
    expect(p).not.toBeNull();
    expect(p!.burnPerDay).toBeCloseTo(40, 5);
  });

  it('returns null with fewer than two readings', () => {
    expect(predictRunOut(series([[0, 100]]), 100)).toBeNull();
    expect(predictRunOut([], 100)).toBeNull();
  });

  it('returns null when the observed span is too short to be meaningful', () => {
    const readings = series([
      [0, 100],
      [6, 90], // only 6h of declining data
    ]);
    expect(predictRunOut(readings, 90)).toBeNull();
  });

  it('returns null when the balance never declines (fresh meter, idle flat)', () => {
    const readings = series([
      [0, 100],
      [12, 100],
      [24, 100],
    ]);
    expect(predictRunOut(readings, 100)).toBeNull();
  });

  it('ignores sub-taka noise between readings', () => {
    const readings = series([
      [0, 100.0],
      [12, 99.999], // noise, not consumption
      [24, 99.998],
    ]);
    expect(predictRunOut(readings, 99.998)).toBeNull();
  });

  it('handles unsorted input', () => {
    const readings = series([
      [12, 210],
      [0, 230],
      [18, 200],
      [6, 220],
    ]);
    const p = predictRunOut(readings, 200);
    expect(p!.burnPerDay).toBeCloseTo(40, 5);
  });

  it('clamps negative balances to zero days left', () => {
    const readings = series([
      [0, 30],
      [12, 10],
      [24, -5],
    ]);
    const p = predictRunOut(readings, -5);
    expect(p!.daysLeft).toBe(0);
  });
});

describe('formatDaysLeft', () => {
  it('says less than a day under 1', () => {
    expect(formatDaysLeft(0.4)).toBe('less than a day');
  });

  it('rounds to halves', () => {
    expect(formatDaysLeft(2.3)).toBe('~2.5 days');
    expect(formatDaysLeft(4.9)).toBe('~5 days');
  });
});
