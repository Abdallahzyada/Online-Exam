import { Schema, Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import type { QuestionInput, QuestionOption } from './question.dto.js';

export interface QuestionRecord extends QuestionInput {
  readonly _id: Types.ObjectId;
  readonly quizId: Types.ObjectId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly revision: number;
}

const optionSchema = new Schema<QuestionOption>({
  optionId: { type: String, required: true, trim: true, maxlength: 64 },
  text: { type: String, required: true, trim: true, maxlength: 2_000 }
}, { _id: false, id: false });

export function createQuestionModel(connection: Connection, collectionName = 'questions'): Model<QuestionRecord> {
  const existing = connection.models.Question as Model<QuestionRecord> | undefined;
  if (existing) return existing;

  const schema = new Schema<QuestionRecord>({
    quizId: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true },
    type: { type: String, enum: ['single', 'multi'], required: true },
    text: { type: String, required: true, trim: true, maxlength: 10_000 },
    options: {
      type: [optionSchema], required: true,
      validate: {
        validator: (value: QuestionOption[]) => value.length >= 2 && value.length <= 100,
        message: 'A question must have between 2 and 100 options'
      }
    },
    correctOptionIds: {
      type: [{ type: String, trim: true }], required: true,
      validate: {
        validator: (value: string[]) => value.length >= 1 && value.length <= 50,
        message: 'A question must have between 1 and 50 correct options'
      }
    },
    points: { type: Number, required: true, default: 1, min: 1, max: 1_000_000, validate: Number.isInteger }
  }, { timestamps: true, versionKey: 'revision', collection: collectionName, strict: 'throw' });

  schema.pre('validate', function validateAnswerKey() {
    const ids = this.options.map(option => option.optionId);
    if (new Set(ids).size !== ids.length) this.invalidate('options', 'Option IDs must be unique');
    const correct = this.correctOptionIds;
    if (new Set(correct).size !== correct.length) this.invalidate('correctOptionIds', 'Correct option IDs must be unique');
    if (correct.some(id => !ids.includes(id))) this.invalidate('correctOptionIds', 'Every correct option must exist in options');
    if (this.type === 'single' && correct.length !== 1) this.invalidate('correctOptionIds', 'Single-choice questions require exactly one correct option');
  });

  schema.index({ quizId: 1, _id: 1 }, { name: 'question_quiz_order' });
  return connection.model<QuestionRecord>('Question', schema, collectionName);
}
