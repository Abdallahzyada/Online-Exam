import type { Request, RequestHandler } from 'express';
import type { AttemptStatus, FinalAttemptStatus, QuestionSnapshot, SubmittedAnswer } from './attempt.dto.js';

// What Attempts needs from the Catalog owner's quiz documents.
export interface AttemptQuiz {
  readonly quizId: string;
  readonly title: string;
  readonly imageUrl: string | null;
  readonly durationMinutes: number;
  readonly passingScorePercentage: number;
  readonly isPublished: boolean;
}
export interface QuizCatalogReader {
  findQuiz(quizId: string): Promise<AttemptQuiz | null>;
}
// What Attempts needs from the Questions owner's documents, already validated (BR-08).
export interface QuestionBankReader {
  listQuestions(quizId: string, limit: number): Promise<QuestionSnapshot[]>;
}

export interface AttemptRecord {
  readonly attemptId: string;
  readonly studentId: string;
  readonly quizId: string;
  readonly status: AttemptStatus;
  readonly quizTitle: string;
  readonly quizImageUrl: string | null;
  readonly questionsCount: number;
  readonly durationMinutes: number;
  readonly passingScorePercentage: number;
  readonly startedAt: Date;
  readonly expiresAt: Date;
  readonly submittedAt: Date | null;
  readonly questions: readonly QuestionSnapshot[];
  readonly answers: readonly SubmittedAnswer[];
  readonly timeSpentSeconds: number | null;
  readonly correctCount: number | null;
  readonly incorrectCount: number | null;
  readonly earnedPoints: number | null;
  readonly totalPoints: number;
  readonly scorePercentage: number | null;
  readonly passed: boolean | null;
}
export interface NewAttempt {
  readonly studentId: string;
  readonly quizId: string;
  readonly quizTitle: string;
  readonly quizImageUrl: string | null;
  readonly durationMinutes: number;
  readonly passingScorePercentage: number;
  readonly startedAt: Date;
  readonly expiresAt: Date;
  readonly questions: readonly QuestionSnapshot[];
}
export interface QuestionResult {
  readonly questionId: string;
  readonly isCorrect: boolean;
}
export interface FinalizedAttempt {
  readonly status: FinalAttemptStatus;
  readonly submittedAt: Date;
  readonly timeSpentSeconds: number;
  readonly answers: readonly SubmittedAnswer[];
  readonly correctCount: number;
  readonly incorrectCount: number;
  readonly earnedPoints: number;
  readonly totalPoints: number;
  readonly scorePercentage: number;
  readonly passed: boolean;
  readonly questionResults: readonly QuestionResult[];
}
export interface ExpireOverdueScope {
  readonly attemptId?: string;
  readonly studentId?: string;
}
export interface AttemptRepository {
  create(attempt: NewAttempt): Promise<AttemptRecord>;
  /** BR-05: every read is scoped to the owner. */
  findOwned(attemptId: string, studentId: string): Promise<AttemptRecord | null>;
  /** BR-12: atomic IN_PROGRESS -> SUBMITTING; true only for the single winner. */
  claimForSubmission(attemptId: string, studentId: string): Promise<boolean>;
  /** SUBMITTING -> SUBMITTED/EXPIRED; false if the claim was lost. */
  finalize(attemptId: string, result: FinalizedAttempt): Promise<boolean>;
  /** Best-effort SUBMITTING -> IN_PROGRESS after a failure before finalizing. */
  releaseClaim(attemptId: string): Promise<void>;
  /** Marks abandoned attempts EXPIRED with a zero score; returns how many changed. */
  expireOverdue(now: Date, scope?: ExpireOverdueScope): Promise<number>;
}

// Compatible with the object returned by the shared createAuth.
export interface AttemptAuth {
  readonly authenticate: RequestHandler;
  readonly requireStudent: RequestHandler;
  studentId(request: Request): string;
}
