import { Types } from 'mongoose';
import type { Connection } from 'mongoose';
import { z } from 'zod';
import { DEFAULT_PASSING_SCORE_PERCENTAGE, questionSnapshotSchema } from './attempt.dto.js';
import type { QuestionSnapshot } from './attempt.dto.js';
import type { QuestionBankReader, QuizCatalogReader } from './attempt.ports.js';

const DATABASE_DEADLINE_MS = 5000;

// Read-only adapters. Catalog and Questions owners keep their models; these
// only describe the fields Attempts reads. Confirm names with those owners.
const storedQuizSchema = z.object({
  title: z.string().min(1),
  imageUrl: z.string().nullish(),
  durationMinutes: z.number(),
  passingScorePercentage: z.number().min(0).max(100).default(DEFAULT_PASSING_SCORE_PERCENTAGE),
  isPublished: z.boolean().default(false),
  // Catalog soft-deletes quizzes; an archived quiz is hidden like an unpublished one.
  isArchived: z.boolean().default(false)
});

export interface AttemptCatalogCollections {
  readonly quizzes: string;
  readonly questions: string;
}

export function createAttemptCatalogReaders(connection: Connection, collections: AttemptCatalogCollections): {
  quizzes: QuizCatalogReader; questions: QuestionBankReader
} {
  return {
    quizzes: {
      async findQuiz(quizId) {
        const document = await connection.collection(collections.quizzes).findOne(
          { _id: new Types.ObjectId(quizId) },
          { projection: { title: 1, imageUrl: 1, durationMinutes: 1, passingScorePercentage: 1, isPublished: 1, isArchived: 1 }, timeoutMS: DATABASE_DEADLINE_MS }
        );
        if (!document) return null;
        const parsed = storedQuizSchema.safeParse(document);
        if (!parsed.success) throw new Error('Stored quiz does not match the attempt contract');
        const { isArchived, isPublished, imageUrl, ...quiz } = parsed.data;
        return { quizId, ...quiz, imageUrl: imageUrl ?? null, isPublished: isPublished && !isArchived };
      }
    },
    questions: {
      async listQuestions(quizId, limit) {
        const documents = await connection.collection(collections.questions).find(
          { quizId: new Types.ObjectId(quizId) },
          { projection: { type: 1, text: 1, options: 1, correctOptionIds: 1, points: 1 }, sort: { _id: 1 }, limit, timeoutMS: DATABASE_DEADLINE_MS }
        ).toArray();
        return documents.map((document): QuestionSnapshot => {
          const parsed = questionSnapshotSchema.safeParse({
            questionId: String(document._id), type: document.type, text: document.text,
            options: document.options, correctOptionIds: document.correctOptionIds, points: document.points ?? 1
          });
          if (!parsed.success) throw new Error('Stored question does not match the attempt contract');
          return parsed.data;
        });
      }
    }
  };
}
