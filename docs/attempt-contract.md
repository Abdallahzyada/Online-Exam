# Attempt contract for team review

Owner: Mohamed Mostafa. This document covers starting, submitting, and reviewing
quiz attempts. Everything lives in `src/modules/attempt/`. No shared file is
changed. The integration steps below are for the platform owner.

## Routes (student only, under `/api/v1`)

| Route | Success | Errors |
| --- | --- | --- |
| `POST /quizzes/:quizId/attempts` | 201 `attemptId, quizTitle, durationMinutes, startedAt, expiresAt, questions[{ questionId, text, type, points, options[{ optionId, text }] }]` | 401, 403 admin, 404 missing or unpublished quiz, 409 `CONFLICT` quiz has no questions or no duration (BR-07) |
| `POST /attempts/:attemptId/submit` body `{ answers: [{ questionId, selectedOptionIds }] }` | 200 `attemptId, scorePercentage, correctCount, incorrectCount, earnedPoints, totalPoints, passed, timeSpentSeconds` | 400 validation (unknown or repeated question, unknown option), 400 `ATTEMPT_EXPIRED`, 404 not owner, 409 `ATTEMPT_ALREADY_SUBMITTED`, 401, 403 |
| `GET /attempts/:attemptId/review` | 200 summary + `status, submittedAt, questions[{ questionId, text, type, options, selectedOptionIds, correctOptionIds, isCorrect, pointsEarned, maxPoints }]` | 403 `ATTEMPT_NOT_SUBMITTED` while in progress, 404 not owner, 401 |

Decisions taken (open to team review):

- An unpublished quiz returns 404, so students cannot learn that it exists.
- Bad answers are rejected with 400 *before* the attempt is claimed, so a
  malformed request never uses up the attempt. Late submissions skip this check.
- A student may hold several attempts for the same quiz.
- `EXPIRED` attempts can be reviewed; every question shows as unanswered.
- Abandoned attempts are finalized as `EXPIRED` by a background sweep every
  60 seconds, and immediately when their review is opened.

## Rules implemented

- BR-09: questions are snapshotted onto the attempt at start.
- BR-10: answer keys are never returned while an attempt is in progress.
- BR-11: the server sets `startedAt` and `expiresAt`, and allows a 10-second grace period.
- BR-12: a single atomic `IN_PROGRESS` → `SUBMITTING` update, so parallel submits
  get exactly one 200. A failed write releases the claim so the student can retry.
  A claim left by a crashed process expires 60 seconds after the grace window.
- BR-13 to BR-15 and BR-18: the pure `score-calculator.ts`. It grades on the exact
  set of option IDs after removing duplicates, with no partial credit. The total
  covers every question, pass means `>= passingScorePercentage`, and time is
  clamped to the quiz duration.

## Stored document (`ATTEMPT_COLLECTION`, default `quizattempts`)

The fields match `dashboard-contract.md` exactly:
`studentId`, `quizId` (ObjectId), `status`, `quizTitle`, `quizImageUrl`,
`questionsCount`, `durationMinutes`, `correctCount`, `scorePercentage`,
`passed`, `timeSpentSeconds`, `submittedAt`, and `questionResults
[{ questionId: hex string, isCorrect }]`. Every question is listed, with unanswered
ones counted as incorrect, and no answer keys are stored in that array.
Additional fields are `passingScorePercentage`, `totalPoints`, `incorrectCount`,
`earnedPoints`, `startedAt`, `expiresAt`, `answers`, and `questions` (the snapshot).
The live test checks that `MongooseDashboardRepository` reads these documents unchanged.

Indexes: Dashboard's `dashboard_student_history` and `dashboard_quiz_analytics`
come from the existing bootstrap. This module adds `attempt_expiry_sweep`
`(status, expiresAt)`.

## Fields read from other modules (please confirm)

- **Catalog (Ali)**, collection `QUIZ_COLLECTION`: `title`, `imageUrl`,
  `durationMinutes`, `passingScorePercentage` (default 50), `isPublished`.
- **Questions (Ziad)**, collection `questions`: `quizId` (ObjectId), `type`
  (`single`/`multi`), `text`, `options[{ optionId, text }]`, `correctOptionIds`,
  and `points` (default 1). Questions are ordered by `_id`. Hard delete is assumed;
  tell me if questions are soft-deleted so the filter can exclude them.

## Integration steps for the platform owner (not done in this branch)

1. In `src/common/errors/public-error.ts`, add `ATTEMPT_EXPIRED`,
   `ATTEMPT_ALREADY_SUBMITTED`, and `ATTEMPT_NOT_SUBMITTED` to the allow-list.
   Until then the HTTP status is correct, but the code reaches clients as `REQUEST_ERROR`.
2. In `src/server.ts`:

   ```ts
   const attempts = createAttemptModule({
     connection: database, auth, report,
     collections: { attempts: env.ATTEMPT_COLLECTION, quizzes: env.QUIZ_COLLECTION }
   });
   await attempts.ensureIndexes();
   // createApp({ ..., moduleRouters: [attempts.router] })
   attempts.startBackgroundJobs();
   // shutdown: stopWorkers: async () => { await attempts.stop(); await workers.close(); }
   ```

## Verification

`npm test` runs the unit, HTTP, and live MongoDB specs. The live spec
(`attempt.integration.spec.ts`) uses a temporary database at
`ATTEMPT_TEST_MONGO_URI` (default `mongodb://127.0.0.1:27017`) and is skipped
when no server is reachable.
