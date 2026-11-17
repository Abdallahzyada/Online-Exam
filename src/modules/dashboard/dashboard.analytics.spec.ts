import { describe, expect, it } from '@jest/globals';
import { calculateQuizAnalytics } from './dashboard.analytics.js';
import { makeAttempt, questionId } from './testing/fixtures.js';

describe('calculateQuizAnalytics', () => {
  it('returns empty ranks, null percentiles, and zero histogram counts without attempts', () => {
    const analytics = calculateQuizAnalytics({ attempts: [] });
    expect(analytics.percentileRankings).toEqual([]);
    expect(analytics.latency).toEqual({ p50: null, p90: null });
    expect(analytics.questions).toEqual([]);
    expect(analytics.scoreDistribution.map(bin => bin.count)).toEqual(Array(10).fill(0));
  });

  it('places exact boundaries into nonoverlapping score bins and includes 100', () => {
    const attempts = [makeAttempt(1, 0, 1), makeAttempt(2, 10, 2), makeAttempt(3, 90, 3), makeAttempt(4, 100, 4)];
    const histogram = calculateQuizAnalytics({ attempts }).scoreDistribution;
    expect(histogram.map(bin => bin.count)).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 2]);
    expect(histogram[9]).toEqual({ from: 90, to: 100, count: 2 });
  });

  it('uses nearest-rank completion times in seconds', () => {
    const attempts = [makeAttempt(1, 20, 90), makeAttempt(2, 40, 10), makeAttempt(3, 60, 30), makeAttempt(4, 80, 20)];
    expect(calculateQuizAnalytics({ attempts }).latency).toEqual({ p50: 20, p90: 90 });
  });

  it('assigns identical percentile ranks to tied scores', () => {
    const attempts = [makeAttempt(1, 50, 10), makeAttempt(2, 50, 20), makeAttempt(3, 100, 30)];
    const ranks = calculateQuizAnalytics({ attempts }).percentileRankings;
    expect(ranks[0]?.percentile).toBeCloseTo(200 / 3);
    expect(ranks[1]?.percentile).toBe(ranks[0]?.percentile);
    expect(ranks[2]?.percentile).toBe(100);
  });

  it('computes failure proportion and upper-minus-lower correctness', () => {
    const attempts = [makeAttempt(1, 0, 10, false), makeAttempt(2, 25, 20, false), makeAttempt(3, 75, 30), makeAttempt(4, 100, 40)];
    expect(calculateQuizAnalytics({ attempts }).questions).toEqual([{ questionId, itemDiscrimination: 1, failureRate: 0.5 }]);
  });

  it('returns null discrimination when there are not two comparison groups', () => {
    expect(calculateQuizAnalytics({ attempts: [makeAttempt(1, 100, 10)] }).questions).toEqual([
      { questionId, itemDiscrimination: null, failureRate: 0 }
    ]);
  });

  it('does not invent observations for questions absent from older snapshots', () => {
    const absent = { ...makeAttempt(1, 0, 10), questionResults: [] };
    const analytics = calculateQuizAnalytics({ attempts: [absent, makeAttempt(2, 100, 20)] });
    expect(analytics.questions[0]).toEqual({ questionId, itemDiscrimination: null, failureRate: 0 });
  });

  it('rejects duplicate question results rather than counting them twice', () => {
    const attempt = makeAttempt(1, 100, 10);
    attempt.questionResults.push({ questionId, isCorrect: true });
    expect(() => calculateQuizAnalytics({ attempts: [attempt] })).toThrow('Duplicate question result');
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid score %s', score => {
    expect(() => calculateQuizAnalytics({ attempts: [makeAttempt(1, score, 10)] })).toThrow();
  });

  it('rejects a payload above the documented bound', () => {
    const attempts = Array.from({ length: 10_001 }, (_, index) => makeAttempt(index, 50, 10));
    expect(() => calculateQuizAnalytics({ attempts })).toThrow();
  });
});
