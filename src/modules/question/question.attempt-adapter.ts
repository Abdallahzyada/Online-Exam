import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { ServiceUnavailableError } from '../../common/errors/app-error.js';
import type { AttemptExportSource } from './question.ports.js';

/**
 * Uses the Attempt module's registered Mongoose model. This adapter deliberately
 * does not create a second QuizAttempt model or schema.
 */
export function createAttemptExportSource(connection: Connection): AttemptExportSource {
  return {
    findByQuizCursor(quizId) {
      const attemptModel = connection.models.QuizAttempt as Model<Record<string, unknown>> | undefined;
      if (!attemptModel) throw new ServiceUnavailableError('Attempt export is not available until the Attempt module is registered');
      return attemptModel.find({ quizId: new Types.ObjectId(quizId) })
        .sort({ _id: 1 }).maxTimeMS(30_000).lean().cursor({ batchSize: 100 });
    }
  };
}
