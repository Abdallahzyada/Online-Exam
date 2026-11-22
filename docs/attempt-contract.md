# Attempt contract for team review

Owner: Mohamed Mostafa. This document covers starting, submitting, and reviewing
quiz attempts. The module lives in `src/modules/attempt/` and is wired into
`src/server.ts` (see "Server integration").

## Routes (student only, under `/api/v1`)

| Route | Success | Errors |
| --- | --- | --- |
| `POST /quizzes/:quizId/attempts` | 201 `attemptId, quizTitle, durationMinutes, startedAt, expiresAt, questions[{ questionId, text, type, points, options[{ optionId, text }] }]` | 401, 403 admin, 404 missing or unpublished quiz, 409 `CONFLICT` quiz has no questions or no duration (BR-07) |
| `POST /attempts/:attemptId/submit` body `{ answers: [{ questionId, selectedOptionIds }] }` | 200 `attemptId, scorePercentage, correctCount, incorrectCount, earnedPoints, totalPoints, passed, timeSpentSeconds` | 400 validation (unknown or repeated question, unknown option), 400 `ATTEMPT_EXPIRED`, 404 not owner, 409 `ATTEMPT_ALREADY_SUBMITTED`, 401, 403 |
| `GET /attempts/:attemptId/review` | 200 summary + `status, submittedAt, questions[{ questionId, text, type, options, selectedOptionIds, correctOptionIds, isCorrect, pointsEarned, maxPoints }]` | 403 `ATTEMPT_NOT_SUBMITTED` while in progress, 404 not owner, 401 |

Decisions taken (open to team review):

- An unpublished or archived (`isArchived`) quiz returns 404, matching the
  Catalog student view.
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

## Fields read from other modules

- **Catalog (Ali)**, collection `QUIZ_COLLECTION`: `title`, `imageUrl`,
  `durationMinutes`, `passingScorePercentage` (default 50), `isPublished`,
  `isArchived`.
- **Questions (Ziad)**, collection `questions`: `quizId` (ObjectId), `type`
  (`single`/`multi`), `text`, `options[{ optionId, text }]`, `correctOptionIds`,
  and `points` (default 1). Questions are ordered by `_id`. Hard delete is assumed;
  tell me if questions are soft-deleted so the filter can exclude them.

## Question limits (agreed upper bound with the Question Bank)

Attempt snapshot limits are an upper bound of the Question Bank request limits, so
a question the Question Bank accepts can always be started:

| Field | Attempts accepts |
| --- | --- |
| Question text | 1 to 10,000 characters |
| Options | 2 to 100, option text up to 2,000 characters |
| Option ID | 1 to 64 characters |
| Points | positive integer |

These match the Question Bank DTO and model on `main` (10,000 characters, 100 options).

## Server integration

- `src/common/errors/public-error.ts` lists `ATTEMPT_EXPIRED`,
  `ATTEMPT_ALREADY_SUBMITTED`, and `ATTEMPT_NOT_SUBMITTED`.
- `src/server.ts` creates the module after auth, ensures the expiry index, adds
  `attempts.router` to the single `moduleRouters` array with the Catalog and
  Question Bank routers, starts the expiry job after the server listens, and
  stops it before MongoDB closes (also when startup fails).
- The model is registered as `QuizAttempt`, which the Question Bank attempt export adapter uses.

## Verification

`npm test` runs the unit, HTTP, and live MongoDB specs. The live spec
(`attempt.integration.spec.ts`) uses a temporary database at
`ATTEMPT_TEST_MONGO_URI` (default `mongodb://127.0.0.1:27017`) and is skipped
when no server is reachable. `npm run check:integration` also starts the real
server and checks starting, submitting (including parallel submits and the grace
window), reviewing, public error codes, archived quizzes, Dashboard history, and
the Question Bank attempt export.
