import { describe, expect, it, jest } from '@jest/globals';
import { DashboardService } from './dashboard.service.js';
import { emptyAnalytics, makeAttempt, makeDependencies, profile, quizId, studentId } from './testing/fixtures.js';

describe('DashboardService', () => {
  it('rejects admission before loading analytics documents', async () => {
    const dependencies = makeDependencies();
    dependencies.analytics.withCapacity = async () => { throw new Error('Analytics admission limit reached'); };
    await expect(new DashboardService(dependencies).getAnalytics(quizId)).rejects.toThrow('admission limit');
    expect(dependencies.repository.getAnalyticsAttempts).not.toHaveBeenCalled();
    expect(dependencies.quizzes.exists).not.toHaveBeenCalled();
    expect(dependencies.analytics.execute).not.toHaveBeenCalled();
  });
  it('returns the profile and student-scoped database KPIs', async () => {
    const dependencies = makeDependencies();
    const kpis = { quizzesPassed: 2, fastestTimeSeconds: 120, totalCorrectAnswers: 35 };
    jest.mocked(dependencies.repository.getKpis).mockResolvedValue(kpis);
    const dashboard = await new DashboardService(dependencies).getDashboard(studentId);
    expect(dashboard).toEqual({ profile, kpis });
    expect(dependencies.repository.getKpis).toHaveBeenCalledWith(studentId);
  });

  it('rejects a missing profile without querying attempts', async () => {
    const dependencies = makeDependencies();
    jest.mocked(dependencies.profiles.findProfile).mockResolvedValue(null);
    await expect(new DashboardService(dependencies).getDashboard(studentId)).rejects.toThrow('student not found');
    expect(dependencies.repository.getKpis).not.toHaveBeenCalled();
  });

  it('returns a null fastest time for a student without passed attempts', async () => {
    const dashboard = await new DashboardService(makeDependencies()).getDashboard(studentId);
    expect(dashboard.kpis).toEqual({ quizzesPassed: 0, fastestTimeSeconds: null, totalCorrectAnswers: 0 });
  });

  it('builds pagination metadata without losing the requested page', async () => {
    const dependencies = makeDependencies();
    jest.mocked(dependencies.repository.getHistory).mockResolvedValue({ entries: [], total: 21 });
    const history = await new DashboardService(dependencies).getHistory(studentId, { page: 2, limit: 10 });
    expect(history.meta).toEqual({ page: 2, limit: 10, total: 21, totalPages: 3 });
    expect(dependencies.repository.getHistory).toHaveBeenCalledWith(studentId, { page: 2, limit: 10 });
  });

  it('uses zero pages for empty history', async () => {
    const history = await new DashboardService(makeDependencies()).getHistory(studentId, { page: 1, limit: 10 });
    expect(history.meta.totalPages).toBe(0);
  });

  it('delegates analytics to the injected worker port', async () => {
    const dependencies = makeDependencies();
    const attempt = makeAttempt(1, 80, 120);
    jest.mocked(dependencies.repository.getAnalyticsAttempts).mockResolvedValue([attempt]);
    const analytics = await new DashboardService(dependencies).getAnalytics(quizId);
    expect(analytics).toEqual(emptyAnalytics);
    expect(dependencies.analytics.execute).toHaveBeenCalledWith({ attempts: [attempt] });
  });

  it('rejects an unknown quiz before reading analytics', async () => {
    const dependencies = makeDependencies();
    jest.mocked(dependencies.quizzes.exists).mockResolvedValue(false);
    await expect(new DashboardService(dependencies).getAnalytics(quizId)).rejects.toThrow('quiz not found');
    expect(dependencies.repository.getAnalyticsAttempts).not.toHaveBeenCalled();
  });

  it('passes worker failure and timeout errors to the caller', async () => {
    const dependencies = makeDependencies();
    const timeout = new Error('Worker timed out');
    jest.mocked(dependencies.analytics.execute).mockRejectedValue(timeout);
    await expect(new DashboardService(dependencies).getAnalytics(quizId)).rejects.toBe(timeout);
  });

  it('does not dispatch a partial dataset after a repository failure', async () => {
    const dependencies = makeDependencies();
    jest.mocked(dependencies.repository.getAnalyticsAttempts).mockRejectedValue(dependencies.errors.analyticsLimit());
    await expect(new DashboardService(dependencies).getAnalytics(quizId)).rejects.toThrow('Analytics dataset limit reached');
    expect(dependencies.analytics.execute).not.toHaveBeenCalled();
  });
});
