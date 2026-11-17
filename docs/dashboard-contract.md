# Dashboard contract for team review

This module covers the student dashboard, quiz history, and admin quiz analytics.
It does not create an Auth model or Attempt model. The local shared foundation
now mounts its router under `/api/v1` and supplies the ports in
`dashboard.ports.ts`. Review this foundation with the platform owner before
merging. See `shared-foundation.md` for setup and extension points.

## Routes

- `GET /api/v1/dashboard/me`: authenticated student only. Returns profile
  (`firstName`, `lastName`, `avatarUrl`) and KPIs.
- `GET /api/v1/dashboard/history?page=1&limit=10`: authenticated student only.
  Returns history entries with `meta.page`, `limit`, `total`, and `totalPages`.
  Page starts at 1. Limit is 1 to 100. Unknown query fields are rejected.
- `GET /api/v1/admin/quizzes/:quizId/analytics`: authenticated admin only.
  Quiz ID must be a 24-character hexadecimal ObjectId.

Success uses `{ success: true, data }`, with `meta` for history. Errors go to the
team's global error handler. The team supplies error factories and the existing
authentication and role middleware. Student ID comes from verified authentication,
never a query field. These routes do not return answer keys or student identities
in analytics. Admin rankings contain attempt IDs only.

## Dashboard and history

KPIs use only `SUBMITTED` attempts for the current student:

- `quizzesPassed`: count where `passed` is true.
- `fastestTimeSeconds`: smallest completion time among passed attempts;
  `null` when there are no passed attempts.
- `totalCorrectAnswers`: sum of `correctCount`, including failed submissions.

History includes `SUBMITTED` and `EXPIRED` attempts. It sorts by `submittedAt`
descending, then `_id` descending for stable ordering. Empty history has total
and totalPages of zero. It follows the written requirements' newest-first list;
category grouping in the design needs a separate team decision.

Each entry contains attemptId, quizId, quizTitle, quizImageUrl, questionsCount,
durationMinutes, correctCount, scorePercentage, passed, timeSpentSeconds, and
submittedAt as a UTC ISO string. Image can be null.

## Data agreement with the Attempt owner

The repository reads the existing collection. It does not define a second model.
Supply its real collection name. The current projection expects these fields:

| Field | Stored value |
| --- | --- |
| `_id`, `studentId`, `quizId` | ObjectId |
| `status` | `SUBMITTED`, `EXPIRED`, or another attempt status |
| `quizTitle`, `quizImageUrl` | Snapshot title and nullable image URL |
| `questionsCount`, `durationMinutes` | Snapshot numbers |
| `correctCount`, `scorePercentage`, `passed` | Final grading values |
| `timeSpentSeconds` | Completion duration in seconds |
| `submittedAt` | Finalization Date, including expired attempts |
| `questionResults` | Array of `{ questionId: string, isCorrect: boolean }` |

Include every graded question in questionResults, including unanswered questions
as incorrect. Do not include answer keys. The question ID is a hexadecimal string
in this read contract. If the shared model stores different names or ObjectIds
inside this array, adapt the repository projection before connecting it.

Agree on these fields with the Attempt owner before merging. Suggested indexes,
owned by that module, are `(studentId, status, submittedAt, _id)` and
`(quizId, status, _id)`. ProfileReader belongs to the Auth adapter; QuizReader
belongs to the quiz adapter. A missing student or quiz uses the shared not-found
error factory.

## Analytics worker agreement

DashboardAnalyticsAdapter sends `{ taskType: 'quiz-analytics', payload }` to the
existing shared worker port. Register `calculateQuizAnalytics` from
`dashboard.analytics.ts` in that long-lived worker's task dispatcher. Do not call
the calculation on the main thread in the real route. The shared manager owns
request IDs, a bounded queue, timeouts, worker failure handling, and shutdown.
The shared implementation lives in `src/common/workers/worker-manager.ts`.

Only submitted attempts enter analytics. These calculation choices are proposed
for review, because the requirements do not fix every formula:

- Ten score buckets: [0,10), [10,20), through [90,100].
- Percentile rank: percentage of scores less than or equal to that score.
  Equal scores receive equal ranks.
- p50 and p90: nearest-rank percentiles of `timeSpentSeconds`. These measure
  attempt completion time, not HTTP request latency. Empty input returns null.
- Failure rate: incorrect observations divided by all observations for that
  question, as a fraction from 0 to 1.
- Item discrimination: upper-group correct fraction minus lower-group correct
  fraction. Each group uses ceil(27% of attempts), capped at half the attempts
  so groups cannot overlap. Sort by score, then attempt ID to resolve ties.
  A missing group or a question absent from a group returns null.

Older snapshots with a missing question do not count as incorrect observations.
Duplicate question IDs within one attempt are rejected.

Each calculation accepts at most 10,000 attempts and 1,000 questions per attempt.
The repository reads at most 10,001 attempts and rejects an oversized quiz using
the injected analyticsLimit error; it never silently reports partial results.
The bootstrap maps this error to 422 `ANALYTICS_LIMIT`, for team review. For larger
quizzes, agree on a batch or offline analytics design before increasing limits.

## Local checks and remaining integration

Run `npm ci`, `npm run typecheck`, `npm test -- --coverage`, and `npm run build`.
Run `npm run check:worker` to verify concurrent calculations through the shared
manager, worker replacement, and a successful calculation after recovery.
This local smoke check is not an HTTP load test.
Tests cover services, calculations, worker-port dispatch, aggregation behavior,
and HTTP routing. HTTP tests use a test-only authentication adapter. Aggregation
tests use mingo with simple fixture IDs; they are not live MongoDB tests.

The shared foundation now connects JWT middleware, shared errors, MongoDB read
adapters, and the worker dispatcher. Before merging, agree on stored fields and
collection names with their owners. Then test against live MongoDB and the
finished modules, including health responsiveness under load. Local tests do not
prove the full server's latency target.

Live server and MongoDB integration checks are now available with npm run verify.
See docs/verification.md for measured results and the remaining team integration scope.
