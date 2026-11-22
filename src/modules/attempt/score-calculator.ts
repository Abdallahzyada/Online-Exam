import type { QuestionSnapshot, SubmittedAnswer } from './attempt.dto.js';

export interface QuestionGrade {
  readonly questionId: string;
  readonly selectedOptionIds: readonly string[];
  readonly isCorrect: boolean;
  readonly pointsEarned: number;
  readonly maxPoints: number;
}
export interface ScoreResult {
  readonly grades: readonly QuestionGrade[];
  readonly correctCount: number;
  readonly incorrectCount: number;
  readonly earnedPoints: number;
  readonly totalPoints: number;
  readonly scorePercentage: number;
  readonly passed: boolean;
}

// BR-13: exact set match on option IDs after de-duplication; no partial credit.
export function gradeQuestion(question: QuestionSnapshot, selected: readonly string[] = []): QuestionGrade {
  const selectedOptionIds = [...new Set(selected)];
  const key = new Set(question.correctOptionIds);
  const isCorrect = selectedOptionIds.length === key.size && selectedOptionIds.every(optionId => key.has(optionId));
  return {
    questionId: question.questionId, selectedOptionIds, isCorrect,
    pointsEarned: isCorrect ? question.points : 0, maxPoints: question.points
  };
}

// BR-14: every snapshot question counts in the denominator, answered or not.
// BR-15: pass/fail is decided here on the server.
export function calculateScore(
  questions: readonly QuestionSnapshot[], answers: readonly SubmittedAnswer[], passingScorePercentage: number
): ScoreResult {
  const selections = new Map(answers.map(answer => [answer.questionId.toLowerCase(), answer.selectedOptionIds]));
  const grades = questions.map(question => gradeQuestion(question, selections.get(question.questionId)));
  const earnedPoints = grades.reduce((sum, grade) => sum + grade.pointsEarned, 0);
  const totalPoints = grades.reduce((sum, grade) => sum + grade.maxPoints, 0);
  const correctCount = grades.filter(grade => grade.isCorrect).length;
  const scorePercentage = totalPoints === 0 ? 0 : Math.round((earnedPoints / totalPoints) * 100);
  return {
    grades, correctCount, incorrectCount: grades.length - correctCount, earnedPoints, totalPoints,
    scorePercentage, passed: scorePercentage >= passingScorePercentage
  };
}

// BR-18: stored completion time never exceeds the quiz duration.
export function clampTimeSpentSeconds(startedAt: Date, finishedAt: Date, durationMinutes: number): number {
  const elapsed = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
  return Math.max(0, Math.min(elapsed, durationMinutes * 60));
}

export function isPastGrace(expiresAt: Date, now: Date, graceMs: number): boolean {
  return now.getTime() > expiresAt.getTime() + graceMs;
}
