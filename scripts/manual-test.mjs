// Local manual-test fixtures only. This is not a registration or login endpoint.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import mongoose from 'mongoose';
import { SignJWT } from 'jose';
import { z } from 'zod';
import { parseEnvironment } from '../dist/config/env.js';

const mode = process.argv[2];
if (!['seed', 'cleanup'].includes(mode)) throw new Error('Use seed or cleanup');
const env = parseEnvironment(process.env);
if (env.NODE_ENV === 'production') throw new Error('Manual fixtures are disabled in production');
const stateFile = new URL('../.local/manual-test.json', import.meta.url);
const idSchema = z.string().regex(/^[a-f0-9]{24}$/);
const stateSchema = z.object({
  runId: z.uuid(), database: z.string(),
  collections: z.object({ users: z.string(), quizzes: z.string(), attempts: z.string() }),
  studentId: idSchema, quizId: idSchema,
  attemptIds: z.array(idSchema).length(3), questionIds: z.array(idSchema).length(2)
}).strict();
const connection = mongoose.createConnection(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
try {
  await connection.asPromise();
  if (!['127.0.0.1', 'localhost', '::1'].includes(connection.host)) {
    throw new Error('Manual fixtures require local MongoDB');
  }
  let state;
  try { state = stateSchema.parse(JSON.parse(await readFile(stateFile, 'utf8'))); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (mode === 'cleanup') {
      console.log('No manual test fixtures to remove.');
      process.exitCode = 0;
    } else {
      const newId = () => new mongoose.Types.ObjectId().toHexString();
      state = {
        runId: randomUUID(), database: connection.name,
        collections: { users: env.USER_COLLECTION, quizzes: env.QUIZ_COLLECTION, attempts: env.ATTEMPT_COLLECTION },
        studentId: newId(), quizId: newId(),
        attemptIds: Array.from({ length: 3 }, newId), questionIds: Array.from({ length: 2 }, newId)
      };
      await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
      await writeFile(stateFile, JSON.stringify(state, null, 2), { flag: 'wx' });
    }
  }
  if (state) {
    if (state.database !== connection.name ||
        state.collections.users !== env.USER_COLLECTION ||
        state.collections.quizzes !== env.QUIZ_COLLECTION ||
        state.collections.attempts !== env.ATTEMPT_COLLECTION) {
      throw new Error('Database settings changed. Restore the previous settings before cleaning these fixtures.');
    }
    const studentId = new mongoose.Types.ObjectId(state.studentId);
    const quizId = new mongoose.Types.ObjectId(state.quizId);
    const users = connection.collection(state.collections.users);
    const quizzes = connection.collection(state.collections.quizzes);
    const attempts = connection.collection(state.collections.attempts);
    const marker = { _manualTestRun: state.runId };
    if (mode === 'cleanup') {
      await attempts.deleteMany({ ...marker, _id: { $in: state.attemptIds.map(value => new mongoose.Types.ObjectId(value)) } });
      await quizzes.deleteOne({ ...marker, _id: quizId });
      await users.deleteOne({ ...marker, _id: studentId });
      await unlink(stateFile);
      console.log('Removed only the manual-test student, quiz, and three attempts.');
    } else {
      await users.updateOne({ _id: studentId, ...marker }, { $setOnInsert: {
        _id: studentId, ...marker, firstName: 'Manual', lastName: 'Student',
        email: 'manual-' + state.runId + '@example.invalid',
        role: 'student', tokenVersion: 0, avatarUrl: null
      } }, { upsert: true });
      await quizzes.updateOne({ _id: quizId, ...marker }, { $setOnInsert: {
        _id: quizId, ...marker, title: 'Manual Test Quiz', isPublished: false,
        durationMinutes: 15, questionsCount: 2, passingScorePercentage: 75
      } }, { upsert: true });
      const correctCounts = [2, 1, 2], seconds = [120, 30, 180];
      for (let index = 0; index < 3; index++) {
        const attemptId = new mongoose.Types.ObjectId(state.attemptIds[index]);
        await attempts.updateOne({ _id: attemptId, ...marker }, { $setOnInsert: {
          _id: attemptId, ...marker, studentId, quizId, status: 'SUBMITTED',
          quizTitle: 'Manual Test Quiz', quizImageUrl: null, questionsCount: 2, durationMinutes: 15,
          correctCount: correctCounts[index], scorePercentage: correctCounts[index] * 50,
          passed: correctCounts[index] === 2, timeSpentSeconds: seconds[index],
          submittedAt: new Date(Date.UTC(2026, 0, index + 1, 12)),
          questionResults: state.questionIds.map((questionId, questionIndex) => ({
            questionId, isCorrect: questionIndex < correctCounts[index]
          }))
        } }, { upsert: true });
      }
      const session = await users.findOne({ _id: studentId, ...marker }, { projection: { tokenVersion: 1 } });
      const tokenVersion = z.number().int().nonnegative().parse(session?.tokenVersion);
      const token = await new SignJWT({ role: 'student', tokenVersion })
        .setProtectedHeader({ alg: 'HS256' }).setSubject(state.studentId)
        .setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
      console.log('Manual test student ready. Running seed again reuses the same fixtures.');
      console.log('Expected KPIs: quizzesPassed=2, fastestTimeSeconds=120, totalCorrectAnswers=5.');
      console.log('TOKEN=' + token);
      console.log('Token expires in one hour. Use it only for local manual testing.');
    }
  }
} finally {
  await connection.close();
}
