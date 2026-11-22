import { describe, expect, it } from '@jest/globals';
import mongoose from 'mongoose';
import { createQuestionModel } from './question.model.js';

const valid = {
  quizId: new mongoose.Types.ObjectId(), type: 'single', text: 'Question?',
  options: [{ optionId: 'a', text: 'A' }, { optionId: 'b', text: 'B' }],
  correctOptionIds: ['a']
};

describe('Question Mongoose model', () => {
  it('registers the Question model once and defines the quiz ordering index', async () => {
    const connection = mongoose.createConnection();
    try {
      const first = createQuestionModel(connection, 'question_records');
      const second = createQuestionModel(connection, 'question_records');
      expect(second).toBe(first);
      expect(first.schema.indexes()).toContainEqual([
        { quizId: 1, _id: 1 }, { name: 'question_quiz_order' }
      ]);
    } finally {
      await connection.close();
    }
  });

  it('defaults points and validates a complete question', async () => {
    const connection = mongoose.createConnection();
    try {
      const Question = createQuestionModel(connection, 'question_records');
      const document = new Question(valid);
      await expect(document.validate()).resolves.toBeUndefined();
      expect(document.points).toBe(1);
      expect(Question.schema.options.timestamps).toBe(true);
    } finally {
      await connection.close();
    }
  });

  it('rejects duplicated option IDs', async () => {
    const connection = mongoose.createConnection();
    try {
      const Question = createQuestionModel(connection, 'question_records');
      const document = new Question({
        ...valid, options: [{ optionId: 'a', text: 'A' }, { optionId: 'a', text: 'Again' }]
      });
      await expect(document.validate()).rejects.toMatchObject({ name: 'ValidationError' });
    } finally {
      await connection.close();
    }
  });

  it('rejects a wrong single-choice answer key', async () => {
    const connection = mongoose.createConnection();
    try {
      const Question = createQuestionModel(connection, 'question_records');
      const document = new Question({ ...valid, correctOptionIds: ['a', 'b'] });
      await expect(document.validate()).rejects.toMatchObject({ name: 'ValidationError' });
    } finally {
      await connection.close();
    }
  });
});
