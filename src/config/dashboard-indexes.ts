import type { Connection } from 'mongoose';

// Stable shared names must also be used by the Attempt owner.
export async function ensureDashboardIndexes(connection: Connection, collection: string): Promise<void> {
  const attempts = connection.collection(collection);
  await attempts.createIndex({ studentId: 1, submittedAt: -1, _id: -1, status: 1 }, { name: 'dashboard_student_history' });
  await attempts.createIndex({ quizId: 1, status: 1, _id: 1 }, { name: 'dashboard_quiz_analytics' });
}
