import type { Request, RequestHandler } from 'express';
import type {
  AnalyticsAttempt, AnalyticsPayload, AnalyticsResponse, DashboardKpis,
  HistoryEntry, HistoryQuery, StudentProfile
} from './dashboard.dto.js';

export interface HistoryRecords {
  readonly entries: readonly HistoryEntry[];
  readonly total: number;
}
export interface DashboardRepository {
  getKpis(studentId: string): Promise<DashboardKpis>;
  getHistory(studentId: string, query: HistoryQuery): Promise<HistoryRecords>;
  getAnalyticsAttempts(quizId: string): Promise<readonly AnalyticsAttempt[]>;
}
export interface ProfileReader {
  findProfile(studentId: string): Promise<StudentProfile | null>;
}
export interface QuizReader {
  exists(quizId: string): Promise<boolean>;
}
export interface AnalyticsExecutor {
  execute(payload: AnalyticsPayload): Promise<AnalyticsResponse>;
}
export interface DashboardErrors {
  notFound(resource: 'student' | 'quiz'): Error;
  analyticsLimit(): Error;
}
export interface DashboardAuth {
  readonly authenticate: RequestHandler;
  readonly requireStudent: RequestHandler;
  readonly requireAdmin: RequestHandler;
  studentId(request: Request): string;
}
export interface SharedWorkerPort {
  run(task: { readonly taskType: 'quiz-analytics'; readonly payload: AnalyticsPayload }): Promise<AnalyticsResponse>;
}
