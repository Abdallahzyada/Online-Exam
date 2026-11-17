import { analyticsPayloadSchema } from './dashboard.dto.js';
import type { AnalyticsAttempt, AnalyticsResponse } from './dashboard.dto.js';

function nearestRank(sorted: readonly number[], percentile: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.ceil(percentile * sorted.length) - 1] ?? null;
}

function scoreDistribution(attempts: readonly AnalyticsAttempt[]): AnalyticsResponse['scoreDistribution'] {
  return Array.from({ length: 10 }, (_, index) => ({
    from: index * 10,
    to: index === 9 ? 100 : (index + 1) * 10,
    count: attempts.filter(attempt => Math.min(9, Math.floor(attempt.scorePercentage / 10)) === index).length
  }));
}

function percentileRankings(attempts: readonly AnalyticsAttempt[]): AnalyticsResponse['percentileRankings'] {
  const scores = attempts.map(attempt => attempt.scorePercentage).sort((left, right) => left - right);
  const ranks = new Map<number, number>();
  scores.forEach((score, index) => {
    const nextScore = scores[index + 1];
    if (nextScore !== score) ranks.set(score, ((index + 1) / scores.length) * 100);
  });
  return attempts.map(attempt => ({ attemptId: attempt.attemptId, percentile: ranks.get(attempt.scorePercentage) ?? 0 }));
}

interface QuestionCount { correct: number; total: number }
function questionCounts(attempts: readonly AnalyticsAttempt[]): Map<string, QuestionCount> {
  const counts = new Map<string, QuestionCount>();
  for (const attempt of attempts) {
    const seen = new Set<string>();
    for (const question of attempt.questionResults) {
      if (seen.has(question.questionId)) throw new Error('Duplicate question result in analytics input');
      seen.add(question.questionId);
      const count = counts.get(question.questionId) ?? { correct: 0, total: 0 };
      count.total++;
      if (question.isCorrect) count.correct++;
      counts.set(question.questionId, count);
    }
  }
  return counts;
}

function discrimination(upper: QuestionCount | undefined, lower: QuestionCount | undefined): number | null {
  if (!upper?.total || !lower?.total) return null;
  return upper.correct / upper.total - lower.correct / lower.total;
}

function questionStatistics(attempts: readonly AnalyticsAttempt[]): AnalyticsResponse['questions'] {
  const sorted = [...attempts].sort((left, right) => left.scorePercentage - right.scorePercentage || left.attemptId.localeCompare(right.attemptId));
  const groupSize = Math.min(Math.floor(attempts.length / 2), Math.ceil(attempts.length * 0.27));
  const lower = questionCounts(sorted.slice(0, groupSize));
  const upper = questionCounts(groupSize ? sorted.slice(-groupSize) : []);
  return [...questionCounts(attempts)].sort(([left], [right]) => left.localeCompare(right)).map(([questionId, count]) => ({
    questionId,
    itemDiscrimination: discrimination(upper.get(questionId), lower.get(questionId)),
    failureRate: (count.total - count.correct) / count.total
  }));
}

export function calculateQuizAnalytics(payload: unknown): AnalyticsResponse {
  const { attempts } = analyticsPayloadSchema.parse(payload);
  const times = attempts.map(attempt => attempt.timeSpentSeconds).sort((left, right) => left - right);
  return {
    scoreDistribution: scoreDistribution(attempts),
    percentileRankings: percentileRankings(attempts),
    latency: { p50: nearestRank(times, 0.5), p90: nearestRank(times, 0.9) },
    questions: questionStatistics(attempts)
  };
}
