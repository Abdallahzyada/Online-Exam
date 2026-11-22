import { describe, expect, it } from '@jest/globals';
import { questionSchema, questionUpdateSchema } from './question.dto.js';

const validQuestion = {
  type: 'single',
  text: 'Which language runs in a browser?',
  options: [
    { optionId: 'a', text: 'JavaScript' },
    { optionId: 'b', text: 'Python' }
  ],
  correctOptionIds: ['a']
} as const;

describe('question DTO validation', () => {
  it('defaults points to one', () => {
    expect(questionSchema.parse(validQuestion).points).toBe(1);
  });

  it('accepts a multi-choice question with multiple correct options', () => {
    expect(questionSchema.safeParse({
      ...validQuestion, type: 'multi', correctOptionIds: ['a', 'b']
    }).success).toBe(true);
  });

  it('rejects fewer than two options', () => {
    expect(questionSchema.safeParse({ ...validQuestion, options: [validQuestion.options[0]] }).success).toBe(false);
  });

  it('rejects duplicate option IDs', () => {
    expect(questionSchema.safeParse({
      ...validQuestion,
      options: [{ optionId: 'a', text: 'One' }, { optionId: 'a', text: 'Two' }]
    }).success).toBe(false);
  });

  it('rejects correct IDs that do not exist in options', () => {
    expect(questionSchema.safeParse({ ...validQuestion, correctOptionIds: ['missing'] }).success).toBe(false);
  });

  it('requires exactly one correct option for single-choice questions', () => {
    expect(questionSchema.safeParse({ ...validQuestion, correctOptionIds: ['a', 'b'] }).success).toBe(false);
  });

  it('requires at least one correct option for multi-choice questions', () => {
    expect(questionSchema.safeParse({ ...validQuestion, type: 'multi', correctOptionIds: [] }).success).toBe(false);
  });

  it('rejects an empty patch and unknown patch properties', () => {
    expect(questionUpdateSchema.safeParse({}).success).toBe(false);
    expect(questionUpdateSchema.safeParse({ unexpected: true }).success).toBe(false);
  });
});
