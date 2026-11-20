import { jest } from '@jest/globals';
import { STALE_CLAIM_MS, SUBMIT_GRACE_MS } from '../attempt.dto.js';
import type { QuestionSnapshot } from '../attempt.dto.js';
import type {
  AttemptQuiz, AttemptRecord, AttemptRepository, ExpireOverdueScope, FinalizedAttempt, NewAttempt, QuestionResult
} from '../attempt.ports.js';
import type { AttemptDependencies } from '../attempt.service.js';

export const studentId = '111111111111111111111111';
export const otherStudentId = '111111111111111111111112';
export const quizId = '222222222222222222222222';
export const q1 = '333333333333333333333331';
export const q2 = '333333333333333333333332';
export const q3 = '333333333333333333333333';
export const unknownId = '999999999999999999999999';
export const startTime = new Date('2026-11-21T10:00:00.000Z');

export const singleQuestion = (questionId = q1, points = 1): QuestionSnapshot => ({
  questionId, text: 'Pick A', type: 'single', points,
  options: [{ optionId: 'opt_a', text: 'A' }, { optionId: 'opt_b', text: 'B' }],
  correctOptionIds: ['opt_a']
});
export const multiQuestion = (questionId = q2, points = 1): QuestionSnapshot => ({
  questionId, text: 'Pick A and C', type: 'multi', points,
  options: [{ optionId: 'opt_a', text: 'A' }, { optionId: 'opt_b', text: 'B' }, { optionId: 'opt_c', text: 'C' }],
  correctOptionIds: ['opt_a', 'opt_c']
});
export const publishedQuiz: AttemptQuiz = {
  quizId, title: 'Node Basics', imageUrl: null, durationMinutes: 15, passingScorePercentage: 50, isPublished: true
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type StoredAttempt = Mutable<AttemptRecord> & { questionResults: QuestionResult[] };

// In-memory stand-in with the same atomic semantics as the Mongo repository:
// each mutation is a synchronous compare-and-set inside one microtask.
export class InMemoryAttemptRepository implements AttemptRepository {
  readonly records = new Map<string, StoredAttempt>();
  private sequence = 0;

  async create(attempt: NewAttempt): Promise<AttemptRecord> {
    const attemptId = (0xaaaa00 + ++this.sequence).toString(16).padStart(24, '0');
    const record: StoredAttempt = {
      attemptId, studentId: attempt.studentId, quizId: attempt.quizId, status: 'IN_PROGRESS',
      quizTitle: attempt.quizTitle, quizImageUrl: attempt.quizImageUrl, questionsCount: attempt.questions.length,
      durationMinutes: attempt.durationMinutes, passingScorePercentage: attempt.passingScorePercentage,
      startedAt: attempt.startedAt, expiresAt: attempt.expiresAt, submittedAt: null,
      questions: structuredClone([...attempt.questions]), answers: [], timeSpentSeconds: null,
      correctCount: null, incorrectCount: null, earnedPoints: null,
      totalPoints: attempt.questions.reduce((sum, question) => sum + question.points, 0),
      scorePercentage: null, passed: null, questionResults: []
    };
    this.records.set(attemptId, record);
    return { ...record };
  }
  async findOwned(attemptId: string, owner: string): Promise<AttemptRecord | null> {
    const record = this.records.get(attemptId);
    return record && record.studentId === owner ? structuredClone(record) : null;
  }
  async claimForSubmission(attemptId: string, owner: string): Promise<boolean> {
    const record = this.records.get(attemptId);
    if (!record || record.studentId !== owner || record.status !== 'IN_PROGRESS') return false;
    record.status = 'SUBMITTING';
    return true;
  }
  async finalize(attemptId: string, result: FinalizedAttempt): Promise<boolean> {
    const record = this.records.get(attemptId);
    if (!record || record.status !== 'SUBMITTING') return false;
    Object.assign(record, structuredClone(result));
    return true;
  }
  async releaseClaim(attemptId: string): Promise<void> {
    const record = this.records.get(attemptId);
    if (record?.status === 'SUBMITTING') record.status = 'IN_PROGRESS';
  }
  async expireOverdue(now: Date, scope: ExpireOverdueScope = {}): Promise<number> {
    const deadline = now.getTime() - SUBMIT_GRACE_MS;
    let changed = 0;
    for (const record of this.records.values()) {
      if (scope.attemptId && record.attemptId !== scope.attemptId) continue;
      if (scope.studentId && record.studentId !== scope.studentId) continue;
      const overdue = record.status === 'IN_PROGRESS' ? record.expiresAt.getTime() < deadline
        : record.status === 'SUBMITTING' && record.expiresAt.getTime() < deadline - STALE_CLAIM_MS;
      if (!overdue) continue;
      Object.assign(record, {
        status: 'EXPIRED', submittedAt: now, timeSpentSeconds: record.durationMinutes * 60, answers: [],
        correctCount: 0, incorrectCount: record.questions.length, earnedPoints: 0, scorePercentage: 0, passed: false,
        questionResults: record.questions.map(question => ({ questionId: question.questionId, isCorrect: false }))
      });
      changed++;
    }
    return changed;
  }
}

export interface Harness {
  readonly dependencies: AttemptDependencies;
  readonly repository: InMemoryAttemptRepository;
  readonly clock: { now: Date };
  advance(milliseconds: number): void;
}

export function makeHarness(questions: QuestionSnapshot[] = [singleQuestion(), multiQuestion()], quiz: AttemptQuiz | null = publishedQuiz): Harness {
  const repository = new InMemoryAttemptRepository();
  const clock = { now: startTime };
  const dependencies: AttemptDependencies = {
    repository,
    quizzes: { findQuiz: jest.fn<AttemptDependencies['quizzes']['findQuiz']>().mockResolvedValue(quiz) },
    questions: { listQuestions: jest.fn<AttemptDependencies['questions']['listQuestions']>().mockResolvedValue(questions) },
    now: () => clock.now
  };
  return { dependencies, repository, clock, advance: milliseconds => { clock.now = new Date(clock.now.getTime() + milliseconds); } };
}
