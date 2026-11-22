import { describe, expect, it } from '@jest/globals';
import { calculateScore, clampTimeSpentSeconds, gradeQuestion, isPastGrace } from './score-calculator.js';
import { multiQuestion, q1, q2, singleQuestion } from './testing/fixtures.js';

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));

describe('ScoreCalculator (BR-13 to BR-15, BR-18)', () => {
  describe('single choice', () => {
    it('awards points for the exact correct option', () => {
      expect(gradeQuestion(singleQuestion(), ['opt_a'])).toMatchObject({ isCorrect: true, pointsEarned: 1, maxPoints: 1 });
    });
    it('awards nothing for a wrong option', () => {
      expect(gradeQuestion(singleQuestion(), ['opt_b'])).toMatchObject({ isCorrect: false, pointsEarned: 0 });
    });
    it('treats an omitted answer as incorrect', () => {
      expect(gradeQuestion(singleQuestion())).toMatchObject({ isCorrect: false, selectedOptionIds: [] });
    });
    it('awards nothing when the correct option is selected with another', () => {
      expect(gradeQuestion(singleQuestion(), ['opt_a', 'opt_b']).isCorrect).toBe(false);
    });
  });

  describe('multi choice', () => {
    it('accepts the exact set out of order and with duplicates', () => {
      const grade = gradeQuestion(multiQuestion(), ['opt_c', 'opt_a', 'opt_a']);
      expect(grade).toMatchObject({ isCorrect: true, pointsEarned: 1, selectedOptionIds: ['opt_c', 'opt_a'] });
    });
    it('gives no partial credit for a subset', () => {
      expect(gradeQuestion(multiQuestion(), ['opt_a']).pointsEarned).toBe(0);
    });
    it('gives nothing when an extra wrong option is selected', () => {
      expect(gradeQuestion(multiQuestion(), ['opt_a', 'opt_b', 'opt_c']).pointsEarned).toBe(0);
    });
  });

  it('weights questions by points', () => {
    const result = calculateScore([singleQuestion(q1, 3), multiQuestion(q2, 1)], [{ questionId: q1, selectedOptionIds: ['opt_a'] }], 50);
    expect(result).toMatchObject({ earnedPoints: 3, totalPoints: 4, scorePercentage: 75, correctCount: 1, incorrectCount: 1 });
  });

  it('keeps unanswered questions in the denominator (10 of 20 answered correctly is 50%)', () => {
    const questions = Array.from({ length: 20 }, (_, index) => singleQuestion(index.toString(16).padStart(24, '0')));
    const answers = questions.slice(0, 10).map(question => ({ questionId: question.questionId, selectedOptionIds: ['opt_a'] }));
    expect(calculateScore(questions, answers, 50)).toMatchObject({ scorePercentage: 50, correctCount: 10, incorrectCount: 10, passed: true });
  });

  it('rounds the percentage to the nearest integer', () => {
    const questions = [singleQuestion('a'.repeat(24)), singleQuestion('b'.repeat(24)), singleQuestion('c'.repeat(24))];
    expect(calculateScore(questions, [{ questionId: 'a'.repeat(24), selectedOptionIds: ['opt_a'] }], 50).scorePercentage).toBe(33);
    const twoOfThree = ['a', 'b'].map(letter => ({ questionId: letter.repeat(24), selectedOptionIds: ['opt_a'] }));
    expect(calculateScore(questions, twoOfThree, 50).scorePercentage).toBe(67);
  });

  it('passes exactly at the passing percentage and fails just below', () => {
    const questions = [singleQuestion(q1), singleQuestion(q2)];
    expect(calculateScore(questions, [{ questionId: q1, selectedOptionIds: ['opt_a'] }], 50).passed).toBe(true);
    expect(calculateScore(questions, [{ questionId: q1, selectedOptionIds: ['opt_a'] }], 51).passed).toBe(false);
  });

  it('matches answers to questions case-insensitively', () => {
    const question = singleQuestion('abcdefabcdefabcdefabcdef');
    expect(calculateScore([question], [{ questionId: 'ABCDEFABCDEFABCDEFABCDEF', selectedOptionIds: ['opt_a'] }], 50).correctCount).toBe(1);
  });

  it('returns zero for an empty quiz instead of dividing by zero', () => {
    expect(calculateScore([], [], 50)).toMatchObject({ scorePercentage: 0, totalPoints: 0 });
  });

  it('clamps time spent between zero and the quiz duration', () => {
    expect(clampTimeSpentSeconds(at(0), at(125), 15)).toBe(125);
    expect(clampTimeSpentSeconds(at(0), at(15 * 60 + 7), 15)).toBe(900);
    expect(clampTimeSpentSeconds(at(10), at(0), 15)).toBe(0);
  });

  it('detects submissions past the grace window', () => {
    expect(isPastGrace(at(0), at(10), 10_000)).toBe(false);
    expect(isPastGrace(at(0), at(11), 10_000)).toBe(true);
  });
});
