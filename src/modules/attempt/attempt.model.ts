import { Schema } from 'mongoose';
import type { Connection, Model, Types } from 'mongoose';
import { ATTEMPT_STATUSES, QUESTION_TYPES } from './attempt.dto.js';
import type { AttemptStatus, QuestionSnapshot, SubmittedAnswer } from './attempt.dto.js';
import type { QuestionResult } from './attempt.ports.js';

export const ATTEMPT_MODEL_NAME = 'QuizAttempt';
export const ATTEMPT_EXPIRY_INDEX = 'attempt_expiry_sweep';

// Field names follow docs/dashboard-contract.md so Dashboard reads this collection unchanged.
export interface AttemptDocument {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  quizId: Types.ObjectId;
  status: AttemptStatus;
  quizTitle: string;
  quizImageUrl: string | null;
  questionsCount: number;
  durationMinutes: number;
  passingScorePercentage: number;
  totalPoints: number;
  startedAt: Date;
  expiresAt: Date;
  submittedAt: Date | null;
  timeSpentSeconds: number | null;
  correctCount: number | null;
  incorrectCount: number | null;
  earnedPoints: number | null;
  scorePercentage: number | null;
  passed: boolean | null;
  questions: QuestionSnapshot[];
  answers: SubmittedAnswer[];
  questionResults: QuestionResult[];
}

const optionSchema = new Schema({
  optionId: { type: String, required: true }, text: { type: String, default: '' }
}, { _id: false });
const questionSnapshotSchema = new Schema({
  questionId: { type: String, required: true },
  text: { type: String, required: true },
  type: { type: String, enum: QUESTION_TYPES, required: true },
  options: { type: [optionSchema], required: true },
  points: { type: Number, required: true, min: 1 },
  correctOptionIds: { type: [String], required: true }
}, { _id: false });
const answerSchema = new Schema({
  questionId: { type: String, required: true }, selectedOptionIds: { type: [String], default: [] }
}, { _id: false });
const questionResultSchema = new Schema({
  questionId: { type: String, required: true }, isCorrect: { type: Boolean, required: true }
}, { _id: false });

export const attemptSchema = new Schema<AttemptDocument>({
  studentId: { type: Schema.Types.ObjectId, required: true },
  quizId: { type: Schema.Types.ObjectId, required: true },
  status: { type: String, enum: ATTEMPT_STATUSES, required: true, default: 'IN_PROGRESS' },
  quizTitle: { type: String, required: true },
  quizImageUrl: { type: String, default: null },
  questionsCount: { type: Number, required: true, min: 1 },
  durationMinutes: { type: Number, required: true, min: 1 },
  passingScorePercentage: { type: Number, required: true, min: 0, max: 100 },
  totalPoints: { type: Number, required: true, min: 1 },
  startedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  submittedAt: { type: Date, default: null },
  timeSpentSeconds: { type: Number, default: null },
  correctCount: { type: Number, default: null },
  incorrectCount: { type: Number, default: null },
  earnedPoints: { type: Number, default: null },
  scorePercentage: { type: Number, default: null },
  passed: { type: Boolean, default: null },
  questions: { type: [questionSnapshotSchema], required: true },
  answers: { type: [answerSchema], default: [] },
  questionResults: { type: [questionResultSchema], default: [] }
}, { autoIndex: false, versionKey: false });

// The history and analytics indexes are provisioned by the shared bootstrap
// (dashboard_student_history, dashboard_quiz_analytics). This module only adds
// the index used to find abandoned attempts.
attemptSchema.index({ status: 1, expiresAt: 1 }, { name: ATTEMPT_EXPIRY_INDEX });

export function getAttemptModel(connection: Connection, collection: string): Model<AttemptDocument> {
  const existing = connection.models[ATTEMPT_MODEL_NAME] as Model<AttemptDocument> | undefined;
  return existing ?? connection.model<AttemptDocument>(ATTEMPT_MODEL_NAME, attemptSchema, collection);
}
