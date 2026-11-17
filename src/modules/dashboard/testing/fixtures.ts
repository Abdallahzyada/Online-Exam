import { jest } from '@jest/globals';
import type { AnalyticsAttempt, AnalyticsResponse } from '../dashboard.dto.js';
import type { DashboardDependencies } from '../dashboard.service.js';

export const studentId = '111111111111111111111111';
export const quizId = '222222222222222222222222';
export const questionId = '333333333333333333333333';
export const profile = { firstName: 'Mohammed', lastName: 'Student', avatarUrl: null };
export const emptyAnalytics: AnalyticsResponse = { scoreDistribution: [], percentileRankings: [], latency: { p50: null, p90: null }, questions: [] };

export function makeDependencies(): DashboardDependencies {
  return {
    repository: {
      getKpis: jest.fn<DashboardDependencies['repository']['getKpis']>().mockResolvedValue({ quizzesPassed: 0, fastestTimeSeconds: null, totalCorrectAnswers: 0 }),
      getHistory: jest.fn<DashboardDependencies['repository']['getHistory']>().mockResolvedValue({ entries: [], total: 0 }),
      getAnalyticsAttempts: jest.fn<DashboardDependencies['repository']['getAnalyticsAttempts']>().mockResolvedValue([])
    },
    profiles: { findProfile: jest.fn<DashboardDependencies['profiles']['findProfile']>().mockResolvedValue(profile) },
    quizzes: { exists: jest.fn<DashboardDependencies['quizzes']['exists']>().mockResolvedValue(true) },
    analytics: {
      withCapacity: async work => work(),
      execute: jest.fn<DashboardDependencies['analytics']['execute']>().mockResolvedValue(emptyAnalytics)
    },
    errors: {
      notFound: resource => new Error(`${resource} not found`),
      analyticsLimit: () => new Error('Analytics dataset limit reached')
    }
  };
}

export function makeAttempt(index: number, score: number, seconds: number, isCorrect = true): AnalyticsAttempt {
  return {
    attemptId: index.toString(16).padStart(24, '0'), scorePercentage: score,
    timeSpentSeconds: seconds, questionResults: [{ questionId, isCorrect }]
  };
}
