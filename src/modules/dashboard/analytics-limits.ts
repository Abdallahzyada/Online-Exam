export const MAX_ANALYTICS_ATTEMPTS = 10_000;
export const MAX_QUESTIONS_PER_ATTEMPT = 1000;
export const MAX_QUESTION_RESULTS = 100_000;
export const MAX_CONCURRENT_ANALYTICS = 2;
export const MAX_PENDING_QUESTION_RESULTS = MAX_QUESTION_RESULTS * MAX_CONCURRENT_ANALYTICS;

export function questionResultCount(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null || !('attempts' in payload) || !Array.isArray(payload.attempts)) return null;
  if (payload.attempts.length > MAX_ANALYTICS_ATTEMPTS) return null;
  let count = 0;
  for (const attempt of payload.attempts) {
    if (typeof attempt !== 'object' || attempt === null || !('questionResults' in attempt) || !Array.isArray(attempt.questionResults)) return null;
    if (attempt.questionResults.length > MAX_QUESTIONS_PER_ATTEMPT) return null;
    count += attempt.questionResults.length;
    if (count > MAX_QUESTION_RESULTS) return null;
  }
  return count;
}
