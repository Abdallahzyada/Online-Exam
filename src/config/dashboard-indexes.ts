import type { Connection } from 'mongoose';

// Reuse equivalent indexes owned by other modules. Never rename or drop them.
export async function ensureDashboardIndexes(connection: Connection, collection: string): Promise<void> {
  const attempts = connection.collection(collection);
  let existing;
  try { existing = await attempts.listIndexes().toArray(); }
  catch (error: unknown) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 26)) throw error;
    existing = [];
  }
  const required = [
    { key: { studentId: 1, submittedAt: -1, _id: -1, status: 1 }, name: 'dashboard_student_history' },
    { key: { quizId: 1, status: 1, _id: 1 }, name: 'dashboard_quiz_analytics' }
  ] as const;
  for (const index of required) {
    const equivalent = existing.some(candidate =>
      JSON.stringify(candidate.key) === JSON.stringify(index.key) && !candidate.hidden &&
      !candidate.sparse && !candidate.partialFilterExpression && !candidate.unique &&
      (!candidate.collation || candidate.collation.locale === 'simple'));
    if (!equivalent) await attempts.createIndex(index.key, { name: index.name });
  }
}
