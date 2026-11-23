# Team A — Code Review Feedback (Project 1: Online Exam Platform)

**Repository:** `elevate-node-c4/Online-Exam-Team-A` (`main`)
**Repository Naming Check:** ⚠️ **Violation** — `Online-Exam-Team-A` uses Title/PascalCase instead of the cohort lowercase `kebab-case` standard (`online-exam-team-a`, matching `app-name-team-a`).
**Codebase Scope Reviewed:** 129 TypeScript files under `src/` (89 production files, 40 `*.spec.ts` files), `scripts/`, `docs/`, `package.json`, `tsconfig.json`, `jest.config.cjs`, `.env.example`
**Verification Executed:**
- `npm run typecheck` (`tsc --noEmit`): **PASS** (0 errors — strict mode + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax`)
- `npm test` (`jest --runInBand`): **39 suites passed, 1 skipped** (`src/modules/attempt/attempt.integration.spec.ts`, gated on live MongoDB `27018`); **442 tests passed, 10 skipped (452 total)**
- `npm run test:coverage`: Fails global Jest coverage thresholds (**branches 78.4% < 80%**, **functions 84.88% < 85%**)

**Standards Applied:** [`clean-code.md`](../../docs/standards/clean-code.md) (`CC-###`) · [`typescript.md`](../../docs/standards/typescript.md) (`TS-###`) · [`testing-jest.md`](../../docs/standards/testing-jest.md) (`JT-###`) · [`restful-api.md`](../../docs/standards/restful-api.md) (`RS-###`) · [`modular-structure.md`](../../docs/standards/modular-structure.md) (`MA-###`) · [Project 1 Requirements](../../docs/project-1-online-exam/requirements.md)

---

## 1. Executive Summary

Team A delivered an impressive, engineering-first backend foundation with strict TypeScript compiler settings, zero `any` escapes in production code, zero `*Sync` blocking calls, strong Auth/OTP cryptographic hygiene, an exemplary atomic `attempt` engine (`IN_PROGRESS -> SUBMITTING -> SUBMITTED/EXPIRED`), MongoDB aggregation pipelines for the student dashboard, backpressured NDJSON/CSV streaming I/O, and a self-healing long-lived `worker_threads` manager.

At the same time, the audit surfaced **4 Critical**, **11 Major**, and **12 Minor** findings that prevent a clean sign-off:
1. **Cross-module & shared-layer boundary breaks:** `src/common/workers/` imports directly from `src/modules/dashboard/` (`MA-502`), `question.repository.ts` mutates the `quizzes` collection directly instead of calling `QuizService.applyQuestionDelta` (leaving empty quizzes published — `BR-07` / `MA-401`), and `diploma` / `quiz` have a circular dependency with non-transactional counter updates (`MA-301` / `CC-504`).
2. **Auth boundary verification & security gaps:** `AuthController` and `AuthRepository` have zero functional/HTTP tests (`auth.routes.spec.ts` only tests `429` rate limits), `/api/v1/auth/register` lacks a dedicated rate limiter (`RS-505`), and `smtp-email-sender.ts` has no transport timeouts (`CC-509`).
3. **Deliverables & wiring omissions:** Root `README.md` is completely missing, Auth and Question Bank lack API documentation (`RS-602`), `DiplomaModel`/`QuizModel` bind to global `mongoose` and ignore `env.QUIZ_COLLECTION`, `question.model.ts` (`max: 50`) conflicts with `question.dto.ts` (`max: 100`), and `npm run test:coverage` misses its configured branch/function thresholds.

### Scorecard

| Dimension | Verdict | Highlights |
| --- | :---: | --- |
| **Type Safety & Compiler Strictness** | **Strong** | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; 2 `res.locals` typing gaps (`TS-101`/`TS-104`) and 1 Mongoose/Zod mismatch (`TS-502`). |
| **Architecture & Modular Structure** | **Needs Work** | Clean ports in `attempt`/`dashboard`, but `MA-502` (`common/workers` -> `dashboard`), `MA-301`/`MA-401` (`diploma`<->`quiz`, `question`->`quizzes`), and `MA-201` (`catalog`/`attempt` -> `dashboard`). |
| **REST, Validation & Security** | **Strong** | `/api/v1` prefix, Zod validation, `helmet`, `cors`, `trust proxy` validation, `timingSafeEqual`, `tokenVersion`; missing `/auth/register` limiter & `totalPages` in question list. |
| **Runtime, Streams & Workers** | **Strong** | Windowed `perf_hooks`, LIFO graceful shutdown, `readline` + batched `insertMany`, `pipeline` + `gzip` + `AbortController`, self-healing `WorkerManager`. |
| **Testing & Coverage** | **Good** | 442 passing unit tests + live integration suite, but `AuthController`/`AuthRepository` untested and global coverage fails thresholds (`78.4%` branches, `84.88%` functions). |
| **Team Deliverables (7 Active Items)** | **26.0 / 35.0 (74.3%)** | Missing root `README.md`, incomplete API docs, and repo naming standard violation (`Online-Exam-Team-A`). *(Demo, Deployment & Docker dropped for Project 1.)* |

---

## 2. Repository Naming & Team Deliverables Audit (Max 35.0 Points)

> **Project 1 Grading Policy:** `Project Demo`, `Deployment`, and `Docker Setup` are dropped for this milestone; their weight is redistributed evenly across the **7 active deliverable items (5.0 points each = 35.0 Max)**.

| # | Deliverable Item | Score / Max | Status | Evidence & Audit Notes |
| :---: | --- | :---: | :---: | --- |
| 1 | **GitHub Repository & Naming** | **4.0 / 5.0** | ⚠️ | Clean 13-PR branch history and `.gitignore`; **-1.0** because repository name `Online-Exam-Team-A` violates the lowercase `kebab-case` naming standard (`online-exam-team-a`). |
| 2 | **README File** | **1.0 / 5.0** | ❌ | **No `README.md` exists at repository root.** Setup notes are fragmented inside `docs/shared-foundation.md` (with stale pre-merge text) and `docs/verification.md`. |
| 3 | **Environment Example** | **4.5 / 5.0** | ✅ | `.env.example` safely documents 22 variables with zero real secrets; **-0.5** for unused `BCRYPT_SALT_ROUNDS` and `OTP_RESEND_COOLDOWN_SECONDS` keys ignored by `src/config/env.ts`. |
| 4 | **API Documentation** | **3.5 / 5.0** | ⚠️ | Well-written contract docs for Attempt (`docs/attempt-contract.md`), Catalog (`docs/catalog-contract.md`), and Dashboard (`docs/dashboard-contract.md`); **-1.5** because Auth and Question Bank endpoints have no API contract docs, Postman collection, or Swagger spec. |
| 5 | **Basic Error Handling** | **5.0 / 5.0** | ✅ | Full `AppError` hierarchy (`app-error.ts`), static message allowlist (`public-error.ts`), sanitized validation details (`public-details.ts`), log-safe `error-report.ts`, and central `global-error-handler.ts`. |
| 6 | **Database Schema** | **4.0 / 5.0** | ⚠️ | Strong compound indexes (`dashboard_student_history`, `attempt_expiry_sweep`, `question_quiz_order`), case-insensitive unique collation indexes, and `select: false` on secrets; **-1.0** for `question.model.ts` `50` vs DTO `100` mismatch and `DiplomaModel`/`QuizModel` ignoring `connection` & `QUIZ_COLLECTION`. |
| 7 | **Project Demo** | *Dropped* | — | Dropped for Project 1 (weight redistributed to the 7 active items). |
| 8 | **Code Organization** | **4.0 / 5.0** | ⚠️ | Vertical slices, strict TS, composition root (`bootstrap.ts`, `registry.ts`); **-1.0** for `MA-502`, `MA-301`/`MA-401`, `MA-201` cross-imports, duplicate unused `common/utils/` files, and missing lint/boundary checks. |
| 9 | **Deployment** | *Dropped* | — | Dropped for Project 1 (weight redistributed to the 7 active items). |
| 10 | **Docker Setup** | *Dropped* | — | Dropped for Project 1 (weight redistributed to the 7 active items). |
| | **Total Deliverables** | **26.0 / 35.0** | **74.3%** | — |

---

## 3. Requirements Coverage Matrix (`BR-01`–`BR-22` & Runtime Specs)

| Rule / Module | Status | Evidence (`file:line`) | Verification Notes |
| --- | :---: | --- | --- |
| **BR-01** Boot-Time Env Validation | ✅ | `src/config/env.ts:11-65`, `src/server.ts:12` | Fail-fast Zod validation of all runtime, JWT, OTP, TLS, proxy, and SMTP variables. |
| **BR-02** Password Storage & Confirmation | ✅ | `src/modules/auth/auth.dto.ts:23-36`, `auth.service.ts:127,286`, `auth.model.ts:36` | `confirmPassword`, complexity, 72-byte UTF-8 check, async `bcrypt` cost 12, `select: false`, `toSafeUser`. |
| **BR-03** Non-Enumerating OTP Recovery | ✅ | `src/modules/auth/auth.service.ts:49-66,186-219`, `auth.repository.ts:55-88` | Async `crypto.randomInt`, HMAC-SHA256 digest, 10m TTL, atomic 60s resend cooldown, generic `200 OK`. |
| **BR-04** Two-Step Reset Verification | ✅ | `src/modules/auth/auth.service.ts:221-307`, `auth.repository.ts:105-209` | `timingSafeEqual`, max 5 attempts, single-use hashed `resetToken`, clears OTP fields & bumps `tokenVersion`. |
| **BR-05** Strict RBAC & Ownership | ✅ | `src/common/middlewares/auth-jwt.ts:30-63`, `attempt.repository.ts:71-75`, `dashboard.repository.ts:10,27` | JWT + live DB `tokenVersion` & `role` check, `requireAdmin`, `{ _id, studentId }` ownership scoping. |
| **BR-06** Two-Level Catalog Integrity | ⚠️ | `diploma.service.ts:71-78`, `quiz.service.ts:19-22,84-106`, `question.repository.ts:26-30,121-124` | Soft-archive works, **but** diploma archive + unpublish has no DB transaction, and `question.repository` doesn't exclude `isArchived: true` quizzes. |
| **BR-07** Quiz Publishability Guard | ⚠️ | `quiz.service.ts:72-95,136-145`, `attempt.service.ts:58-65`, `question.repository.ts:126-138` | `QuizService.setPublished` & `startAttempt` enforce `>= 1` question, **but** deleting the last question via `question.repository` bypasses `QuizService.applyQuestionDelta`, leaving `isPublished: true` with `0` questions. |
| **BR-08** Question Style & Answer Key | ⚠️ | `question.dto.ts:8-33`, `question.model.ts:36,43-50` | `single`/`multi` subset & option ID rules enforced; **gap:** `question.model.ts:36` caps `correctOptionIds` at `50` vs DTO `100`. |
| **BR-09** Attempt Snapshot Isolation | ✅ | `attempt.service.ts:63-71`, `attempt.model.ts:39-46,73` | Full question snapshot stored on `QuizAttempt` at start. |
| **BR-10** Zero Answer-Key Leakage | ✅ | `attempt.service.ts:73-80,133`, `dashboard.repository.ts:32-38` | `correctOptionIds` stripped on start; `/review` blocked with `403 ATTEMPT_NOT_SUBMITTED` while `IN_PROGRESS`. |
| **BR-11** Server Timer & 10s Grace | ✅ | `attempt.service.ts:66-70,98-105`, `attempt.dto.ts:8`, `score-calculator.ts:54-56` | `SUBMIT_GRACE_MS = 10_000`; past-grace persists `EXPIRED` (`0` score, `passed: false`) and returns `400 ATTEMPT_EXPIRED`. |
| **BR-12** Atomic Double-Submit Guard | ✅ | `attempt.repository.ts:77-99`, `attempt.service.ts:91-118` | Atomic `IN_PROGRESS -> SUBMITTING` claim + conditional finalize; parallel submits return `409 ATTEMPT_ALREADY_SUBMITTED`. |
| **BR-13** Exact-Set Weighted Scoring | ✅ | `score-calculator.ts:21-29` | Deduplicated option IDs, exact set equality, zero partial credit, `question.points`. |
| **BR-14** Full-Quiz Denominator | ✅ | `score-calculator.ts:33-46` | Sums all snapshot `points`; omitted questions score `0` and stay in denominator. *(Minor `.toLowerCase()` lookup asymmetry at line 37.)* |
| **BR-15** Pass/Fail Threshold | ✅ | `score-calculator.ts:44`, `quiz.dto.ts:13` | `scorePercentage >= passingScorePercentage` (default `50`). |
| **BR-16** Fastest Time Passed-Only | ✅ | `dashboard.repository.ts:10,17-20,68-72` | Filters `{ status: 'SUBMITTED', passed: true }`; returns `null` when 0 passed. |
| **BR-17** DB-Side Aggregation | ✅ | `dashboard.repository.ts:8-43,66-78` | `$match`/`$sort`/`$facet`/`$group`/`$project` in MongoDB. |
| **BR-18** Clamped Completion Time | ✅ | `score-calculator.ts:49-52` | `Math.max(0, Math.min(elapsed, durationMinutes * 60))`. |
| **BR-19** Non-Blocking Runtime & Health | ✅ | `event-loop-monitor.ts:22-69`, `health.routes.ts:11-25` | Zero `*Sync`, windowed `perf_hooks`, `/api/v1/health` (`200`/`503`). |
| **BR-20** Bounded-Memory Streaming I/O | ✅ | `question.streams.ts:34-181`, `question.export.ts:15-58` | `readline` + 64 KB/line cap + 100-doc `insertMany`; cursor -> transform -> optional `createGzip()` -> `pipeline` + `AbortController` on `res.close`. |
| **BR-21** Self-Healing Worker Thread | ✅ | `worker-manager.ts:28-165`, `analytics.worker.ts:1-16` | Long-lived worker, `requestId` map, bounded queue/memory admission, crash/timeout reject & respawn with backoff. |
| **BR-22** Prefix, Validation & Envelopes | ⚠️ | `app.ts:25,33`, `global-error-handler.ts:7-40`, `question.controller.ts:28` | Uniform `/api/v1` + Zod + error envelope; **gap:** `question.controller.ts:28` omits `totalPages` in `meta`. |

---

## 4. Categorized Findings & Actionable Fixes

### Critical Findings

**CRIT-1 — `src/common/workers/worker-manager.ts:3` (also `analytics.worker.ts:2`, `worker-protocol.ts:2`) — `MA-502` (critical): Shared `common/` infrastructure imports directly from feature module `modules/dashboard/`.**
```ts
// Offending Code (src/common/workers/worker-manager.ts:3,6 & src/common/workers/analytics.worker.ts:2)
import type { AnalyticsResponse } from '../../modules/dashboard/dashboard.dto.js';
import {
  MAX_CONCURRENT_ANALYTICS,
  MAX_PENDING_QUESTION_RESULTS,
  questionResultCount
} from '../../modules/dashboard/analytics-limits.js';
// analytics.worker.ts:
import { calculateQuizAnalytics } from '../../modules/dashboard/dashboard.analytics.js';
```
- **Why it is dangerous:** Lower shared infrastructure depending upward on a feature module violates the dependency rule, introduces circular coupling risk, and prevents `common/workers/` from serving other domain modules cleanly.
- **Fix:** Move generic worker transport/protocol contracts (`WorkerRequest<TPayload>`, `WorkerResponse<TResult>`, `WorkerTaskHandler`) into `src/common/workers/` and register the `dashboard` analytics task handler & admission validator from `src/bootstrap.ts` / a worker task registry:
```ts
// src/common/workers/worker-protocol.ts
export interface WorkerTaskSpec<TPayload, TResult> {
  taskType: string;
  validatePayload: (payload: unknown) => TPayload;
  execute: (payload: TPayload) => TResult;
}
```

---

**CRIT-2 — `src/modules/question/question.repository.ts:126-138` — `MA-401` (critical) + `CC-204` + `CC-805` (`BR-07`): `QuestionRepository` mutates `quizzes` directly and bypasses `QuizService.applyQuestionDelta`.**
```ts
// Offending Code (src/modules/question/question.repository.ts:126-138)
private async incrementQuizCounters(
  quizId: Types.ObjectId,
  questionsCount: number,
  totalPoints: number,
  session?: ClientSession
): Promise<void> {
  const result = await this.quizzes.updateOne(
    { _id: quizId },
    { $inc: { questionsCount, totalPoints } },
    session ? { session } : {}
  );
  if (result.matchedCount !== 1) throw new NotFoundError('Quiz');
}
```
- **Why it is dangerous:** Two separate modules write directly to the `quizzes` collection with different invariants. `QuizService.applyQuestionDelta` (`src/modules/quiz/quiz.service.ts:136-145`) unpublishes a quiz and decrements `diploma.quizzesCount` when `questionsCount` reaches `0`, whereas `QuestionRepository.delete()` skips both — leaving an empty quiz visibly published (`BR-07` violation).
- **Fix:** Inject a narrow `QuizCatalogCounterPort` (implemented by `QuizService.applyQuestionDelta`) into `QuestionService`/`QuestionRepository` rather than writing to `this.quizzes` directly:
```ts
// src/modules/question/question.ports.ts
export interface QuizCatalogCounterPort {
  applyQuestionDelta(quizId: string, questionsDelta: number, pointsDelta: number, session?: ClientSession): Promise<void>;
}
```

---

**CRIT-3 — `src/modules/diploma/diploma.service.ts:4` & `src/modules/quiz/quiz.service.ts:3` — `MA-401` / `MA-301` (critical) + `TS-604` + `CC-204`: Circular dependency and cross-module collection mutations between `diploma/` and `quiz/`.**
```ts
// Offending Code (src/modules/diploma/diploma.service.ts:4,74 & src/modules/quiz/quiz.service.ts:3-4,93)
// diploma.service.ts:
import { QuizRepository, type QuizListOptions } from '../quiz/quiz.repository.js';
await this.quizzes.unpublishAllByDiploma(id);

// quiz.service.ts:
import { DiplomaRepository } from '../diploma/diploma.repository.js';
import { DiplomaService } from '../diploma/diploma.service.js';
await this.diplomas.incrementQuizCount(String(quiz.diplomaId), isPublished ? 1 : -1);
```
- **Why it is dangerous:** Bidirectional dependencies between `diploma` and `quiz` (controllers, routes, services, repositories) couple two modules into a cycle where each mutates the other's persistence state without owning the full invariant.
- **Fix:** Consolidate `diploma` and `quiz` under one cohesive `src/modules/catalog/` vertical slice (where they share a single bounded context) or invert the dependency using an injected `QuizArchivePort` wired at the composition root (`src/modules/registry.ts`).

---

**CRIT-4 — `src/modules/auth/auth.controller.ts:1` & `src/modules/auth/auth.repository.ts:1` (`auth.routes.spec.ts:41`) — `JT-701` (critical, escalated on auth boundary) + `JT-707` (major): Auth HTTP boundary and `AuthRepository` lack functional/integration tests.**
- **Offending State:** `src/modules/auth/auth.routes.spec.ts:41-104` only sends empty `{}` bodies to trigger `429` rate-limit responses. There are **0 tests** exercising `AuthController` handlers (`register`, `login`, `logout`, `me`, `forgotPassword`, `verifyResetCode`, `resetPassword`) or `AuthRepository` Mongoose operations (`storeResetOtp`, `recordFailedOtpAttempt`, `issuePasswordResetToken`, `resetPasswordWithToken`).
- **Why it is dangerous:** `AuthController` `res.locals` handoff, HTTP status codes (`201`/`200`/`401`/`409`), JWT `tokenVersion` revocation, and atomic OTP lockout queries are completely unverified at runtime.
- **Fix:** Add `supertest` cases in `auth.routes.spec.ts` exercising full register → login → `/auth/me` → logout (stale JWT rejected `401`) → 3-step OTP reset with an in-memory `AuthRepository` + `createErrorHandler`, plus repository specs for atomic OTP/lockout filters.

---

### Major Findings

**MAJ-1 — `src/modules/diploma/diploma.service.ts:74-75` & `src/modules/quiz/quiz.service.ts:91-93` — `CC-504` / `CC-507` (major): Multi-step catalog state transitions lack transactions and atomic status guards.**
```ts
// Offending Code (src/modules/diploma/diploma.service.ts:74-75)
await this.quizzes.unpublishAllByDiploma(id);
const archived = await this.diplomas.updateById(id, { isActive: false, quizzesCount: 0 });
```
- **Why it is dangerous:** A failure between the two writes leaves `quizzesCount` permanently inaccurate or quizzes published under an archived diploma; concurrent `setPublished(id, true)` calls can double-increment `quizzesCount`.
- **Fix:** Execute both updates inside `connection.startSession()` + `session.withTransaction(...)` and gate `setPublished` with an atomic conditional update `{ _id: id, isPublished: !isPublished }`.

**MAJ-2 — `src/modules/question/question.model.ts:36` — `TS-502` (major): Mongoose `correctOptionIds` validator caps at `50`, disagreeing with Zod DTO (`100`).**
```ts
// Offending Code (src/modules/question/question.model.ts:36)
validator: (value: string[]) => value.length >= 1 && value.length <= 50,
message: 'A question must have between 1 and 50 correct options'
```
- **Why it is dangerous:** `question.dto.ts:12` and `attempt.dto.ts:33` accept up to `100` `correctOptionIds`; payloads with 51–100 correct options pass Zod validation and crash in Mongoose with `500`.
- **Fix:** Align `question.model.ts:36-37` to `value.length >= 1 && value.length <= 100`.

**MAJ-3 — `src/modules/diploma/diploma.model.ts:20` & `src/modules/quiz/quiz.model.ts:36` — `CC-208` / `MA-602` (major): Catalog models bind eagerly to global `mongoose` singleton and ignore `env.QUIZ_COLLECTION`.**
```ts
// Offending Code (src/modules/diploma/diploma.model.ts:20 & src/modules/quiz/quiz.model.ts:36)
export const DiplomaModel = model('Diploma', diplomaSchema);
export const QuizModel = model('Quiz', quizSchema);
```
- **Why it is dangerous:** Unlike `Auth`, `Question`, `Attempt`, and `Dashboard`, Catalog ignores the app's configured `connection` and `env.QUIZ_COLLECTION`, causing split collections/connections whenever `QUIZ_COLLECTION` is customized or tests use isolated connections.
- **Fix:** Export `createDiplomaModel(connection)` and `createQuizModel(connection, collectionName)` and wire them from `src/modules/registry.ts:63`.

**MAJ-4 — `src/modules/diploma/diploma.controller.ts:3` (`catalog.routes.ts:2`, `attempt.dto.ts:2-3`) — `MA-201` (major): `catalog` and `attempt` import shared contracts from `modules/dashboard/`.**
- **Why it is dangerous:** Couples independent modules to `dashboard` internals (`DashboardAuth`, `objectIdSchema`, `MAX_QUESTIONS_PER_ATTEMPT`).
- **Fix:** Move `RequestAuth` type to `src/common/middlewares/auth-jwt.ts` and shared `objectIdSchema` / question bounds to `src/common/utils/validation.ts`.

**MAJ-5 — `src/modules/diploma/diploma.controller.ts:15`, `src/modules/quiz/quiz.controller.ts:8` & `src/modules/question/question.controller.ts:25` — `TS-101` / `TS-104` (major): Untyped `res.locals` (`any`) and unsafe `as` assertions in controllers.**
- **Why it is dangerous:** `diploma` and `quiz` controllers pass untyped `res.locals.body` (`any`) into services; `question.controller.ts:25-27` casts `res.locals.params as Params` with a silent `?? ''` fallback instead of failing fast if validation middleware was skipped.
- **Fix:** Declare typed `Locals` interfaces and read via a guarded helper matching `src/modules/attempt/attempt.controller.ts:8-12`.

**MAJ-6 — `src/modules/auth/auth.routes.ts:86` — `RS-505` (major): `POST /api/v1/auth/register` lacks a dedicated auth rate limiter.**
- **Why it is dangerous:** While `login`, `forgot-password`, `verify-reset-code`, and `reset-password` use `createAuthRateLimit(3|5)`, `register` falls back to the 300 req/15m global limiter, enabling automated account spam and email probing (`409`).
- **Fix:** Add `const registerRateLimit = createAuthRateLimit(5);` to `router.post('/auth/register', registerRateLimit, ...)`.

**MAJ-7 — `src/common/utils/smtp-email-sender.ts:23` — `CC-509` (major): SMTP transport created without network timeouts.**
- **Why it is dangerous:** A hanging SMTP endpoint stalls `forgotPassword` handlers for OS TCP timeout duration.
- **Fix:** Pass `connectionTimeout: 5_000, greetingTimeout: 5_000, socketTimeout: 10_000` to `nodemailer.createTransport(...)`.

**MAJ-8 — `src/modules/question/question.controller.ts:28` — `RS-401` (major): `GET /quizzes/:quizId/questions` omits `totalPages` from pagination `meta`.**
- **Why it is dangerous:** Inconsistent pagination envelope across endpoints (`diploma` and `dashboard` include `totalPages`).
- **Fix:** Pass `totalPages: Math.ceil(result.total / result.limit)` into `paginated(...)`.

**MAJ-9 — `src/modules/auth/auth.controller.ts:31-155` & `src/modules/dashboard/dashboard.controller.ts:12-35` — `CC-407` (major): Repeated `try { ... } catch (error) { next(error); }` boilerplate in controllers.**
- **Fix:** Wrap route handlers with `asyncHandler(...)` from `src/common/middlewares/async-handler.ts` (matching `attempt.controller.ts` and `question.controller.ts`).

**MAJ-10 — `src/modules/auth/auth.service.ts:68-75` — `CC-301` (major): Duplicates `isDuplicateKeyError` already exported by `src/common/utils/mongo-errors.ts`.**
- **Fix:** Delete the local `isDuplicateKeyError` function in `auth.service.ts` and import it from `../../common/utils/mongo-errors.js`.

**MAJ-11 — `src/modules/question/question.repository.ts:26,122` — `CC-805` (major): `quizExists` and `assertQuizExists` omit `isArchived: { $ne: true }`.**
- **Why it is dangerous:** Admins can add, update, or stream-import questions into a soft-archived quiz.
- **Fix:** Filter `{ _id: new Types.ObjectId(quizId), isArchived: { $ne: true } }` in both methods.

---

### Minor Findings

- **MIN-1 — `src/common/utils/async-handler.ts:1` & `src/common/utils/response.ts:1` — `CC-604` (minor):** Unused dead duplicates of `common/middlewares/async-handler.ts` and `common/utils/response-envelope.ts`. **Fix:** Delete both unused files.
- **MIN-2 — `src/modules/attempt/score-calculator.ts:37` — `CC-001` (minor):** `selections` keys are `.toLowerCase()` at line 36, but lookup at line 37 uses `selections.get(question.questionId)` without `.toLowerCase()`. **Fix:** Use `selections.get(question.questionId.toLowerCase())`.
- **MIN-3 — `src/modules/question/question.controller.ts:100` & `question.streams.ts:173-176` — `RS-406` / `CC-602` (minor):** `exportAttempts` uses `fallbackColumns` (exposing raw document key order including full `questions` snapshots) and carries a stale comment about `quizTitle`/`quizImageUrl`. **Fix:** Define explicit `ATTEMPT_EXPORT_COLUMNS` and remove the stale comment.
- **MIN-4 — `src/modules/auth/auth.dto.ts:31` — `CC-301` (minor):** `avatarUrl: z.url().optional()` allows non-HTTP(S) schemes (`javascript:`). **Fix:** Reuse `httpUrl` from `../../common/utils/http-url.js`.
- **MIN-5 — `src/modules/catalog/catalog.routes.ts:1` — `MA-101` / `MA-002` (minor):** Inconsistent internal structure across sibling modules (`catalog` split across 3 folders with validation inside `*.dto.ts` vs `*.validation.ts` in `attempt`/`dashboard`). **Fix:** Standardize module layout.
- **MIN-6 — `package.json:5` — `MA-304` (minor):** Missing ESLint/Prettier and static boundary/cycle checks (`madge --circular` / `dependency-cruiser`). **Fix:** Add `lint` and `arch:check` scripts.
- **MIN-7 — `src/config/env.ts:11` — `CC-604` (minor):** `.env.example:8-9` defines `OTP_RESEND_COOLDOWN_SECONDS` and `BCRYPT_SALT_ROUNDS`, which `env.ts` never parses (`auth.service.ts` hardcodes `12` and `60_000`). **Fix:** Wire them through `env.ts` or remove them from `.env.example`.
- **MIN-8 — `src/modules/diploma/diploma.service.ts:30` & `quiz.service.ts:21` — `CC-404` (minor):** `new NotFoundError('Diploma not found')` produces `"Diploma not found not found"`. **Fix:** Pass `'Diploma'` / `'Quiz'`.
- **MIN-9 — `src/modules/auth/auth.routes.ts:1` & `question.routes.ts:1` — `RS-602` (minor):** Auth and Question Bank endpoints lack API documentation. **Fix:** Add root `README.md` + `docs/auth-contract.md` and `docs/question-contract.md`.
- **MIN-10 — `src/modules/catalog/catalog.repositories.spec.ts:9` (`question.repository.spec.ts:23`, `question.attempt-adapter.spec.ts:11`) — `JT-208` (minor):** Deep hand-written Mongoose query chain stubs; prefer in-memory fakes or live DB integration specs.
- **MIN-11 — `src/modules/auth/auth.service.spec.ts:283` & `dashboard.analytics.spec.ts:58` — `JT-403` (minor):** Bare `.toThrow()` without pinning `NotFoundError` / `ZodError`. **Fix:** Pass explicit error classes.
- **MIN-12 — `src/modules/auth/auth.service.spec.ts:367` — `JT-602` (minor):** Uses live `Date.now()` in OTP expiry test data instead of `jest.useFakeTimers()` or an injected clock. **Fix:** Use `jest.useFakeTimers()`.

---

## 5. Strengths & Priority Action Plan

### Commendable Engineering Practices
- **Compiler & Runtime Discipline:** Strictest possible `tsconfig.json`, zero `any` in production code, zero `*Sync` calls, explicit CIDR `TRUST_PROXY` validation, production MongoDB TLS guard, and log-safe `describeError` redaction (`error-report.ts`).
- **Attempt Engine (`src/modules/attempt/`):** Textbook ports-and-adapters isolation, atomic `IN_PROGRESS -> SUBMITTING` state transition (`BR-12`), deterministic `ScoreCalculator`, `unref()` expiry sweeper, and a real MongoDB integration test suite (`attempt.integration.spec.ts`).
- **Streams & Worker Engineering (`src/modules/question/`, `src/common/workers/`):** Line-bounded NDJSON streaming with batched `insertMany`, `pipeline` + `createGzip()` + `res.close` `AbortController`, CSV injection neutralization, and a self-healing `WorkerManager` with backpressure caps.

### Priority Fix Order
1. **Create root `README.md`** (prerequisites, env table, quick start, scripts, API summary) and add `auth`/`question` API docs (`RS-602`).
2. **Fix `BR-07` & `MA-401`:** Route `question` counter deltas through `QuizService.applyQuestionDelta`, exclude `isArchived: true` in `question.repository.ts`, align `question.model.ts` max `correctOptionIds` to `100`, and add transactions + atomic guards to `diploma`/`quiz` (`CC-504`).
3. **Break `MA-502` & `MA-301`:** Invert `common/workers/` -> `modules/dashboard/` via a generic worker task registry, resolve `diploma` <-> `quiz` coupling, and pass `connection` + `env.QUIZ_COLLECTION` to Catalog models.
4. **Close Auth & Coverage Gaps:** Add `auth.routes.spec.ts` functional + `AuthRepository` tests, rate-limit `POST /auth/register`, add SMTP timeouts, and raise branch/function coverage above `80%`/`85%`.
5. **Rename repository** from `Online-Exam-Team-A` to `online-exam-team-a` on GitHub to comply with cohort naming standards.
