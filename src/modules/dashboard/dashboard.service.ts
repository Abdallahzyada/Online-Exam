import type { AnalyticsResponse, DashboardResponse, HistoryPage, HistoryQuery } from './dashboard.dto.js';
import type { AnalyticsExecutor, DashboardErrors, DashboardRepository, ProfileReader, QuizReader } from './dashboard.ports.js';

export interface DashboardDependencies {
  readonly repository: DashboardRepository;
  readonly profiles: ProfileReader;
  readonly quizzes: QuizReader;
  readonly analytics: AnalyticsExecutor;
  readonly errors: DashboardErrors;
}

export class DashboardService {
  constructor(private readonly dependencies: DashboardDependencies) {}

  async getDashboard(studentId: string): Promise<DashboardResponse> {
    const { profiles, repository, errors } = this.dependencies;
    const profile = await profiles.findProfile(studentId);
    if (!profile) throw errors.notFound('student');
    const kpis = await repository.getKpis(studentId);
    return { profile, kpis };
  }

  async getHistory(studentId: string, query: HistoryQuery): Promise<HistoryPage> {
    const { entries, total } = await this.dependencies.repository.getHistory(studentId, query);
    return {
      entries,
      meta: { ...query, total, totalPages: Math.ceil(total / query.limit) }
    };
  }

  async getAnalytics(quizId: string): Promise<AnalyticsResponse> {
    const { quizzes, repository, analytics, errors } = this.dependencies;
    return analytics.withCapacity(async () => {
      if (!await quizzes.exists(quizId)) throw errors.notFound('quiz');
      const attempts = await repository.getAnalyticsAttempts(quizId);
      return analytics.execute({ attempts: [...attempts] });
    });
  }
}
