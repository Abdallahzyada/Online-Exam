# Local verification

Date: 2026-11-17

Scope: Dashboard and Analytics plus the shared foundation currently in this
repository. Other members' unfinished Auth, Catalog, Question, and Attempt
features are outside this result.

## Results

- TypeScript strict checks: passed.
- Production build: passed.
- Jest: 109 tests passed across 11 suites.
- Collected coverage: statements 96.40%, branches 89.24%, functions 96.07%,
  lines 98.99%. Server bootstrap, the database connection helper, and the worker
  entry point are exercised by the real integration checks rather than included
  in Jest coverage.
- Real worker checks: reuse, concurrent request correlation, idle termination,
  error, unexpected exit, and timeout recovery passed. Both pending requests
  rejected on each injected failure, and the replacement completed the next job.
- Live integration: 25 scenarios passed through the actual server process, local
  MongoDB, signed JWTs, and the production worker manager.
- Startup checks: invalid environment, unavailable MongoDB, and an occupied HTTP
  port failed cleanly with exit code 1.
- Graceful shutdown: the real SIGTERM callback closed the server, worker and
  database and exited with code 0. The Windows test bridge emits that signal
  inside the child process; it does not claim to test Windows OS signal delivery.

The integration checks cover student data isolation, empty/all-failed KPIs,
pagination, UTC timestamps, safe projections, submitted-only analytics, role
checks, stored token revocation, validation errors, malformed stored data, and
the analytics size limit. They use a unique temporary database starting with
online_exam_check_ and drop only that database in cleanup.

## Local workload observation

One analytics request processed 5,000 attempts with 100,000 question results.

- Analytics request: about 1,005 ms.
- Health replies sampled during the request: 49.
- Slowest sampled health request: about 68 ms.
- Event-loop maximum delay: 75.89 ms.
- Event-loop p99 delay: 28.11 ms.

The check requires the observed event-loop maximum to stay below 100 ms.
These are observations on this computer for this workload, not a guarantee for
all datasets, machines, or the completed team application.

## Fix from this review

An unmatched path under /api/v1 previously returned 401 because the Dashboard
router authenticated every request before matching a route. Authentication now
runs on each matching Dashboard route. A regression test confirms unknown API
paths return 404 while protected routes keep their 401/403 checks.

## Dependency audit

npm audit --omit=dev reported zero known vulnerabilities in runtime dependencies.
The full audit reports 18 moderate affected package entries in the Jest tooling
chain, rooted in glob and minimatch. Compatible updates were applied; these
remaining findings require a separate dependency decision. No forced major
version downgrade was applied.

## Repeat

Run npm run verify with local MongoDB available at 127.0.0.1:27017.
It runs coverage tests, builds the project, tests real workers, then runs the
live integration checks. Integration checks use generated secrets and fixtures,
not a user's .env or existing database. npm run check:integration alone assumes
the current source has already been built.

Before team merge, confirm collection names and stored fields with module
owners. Full registration, login/logout mutations, password recovery, catalog,
quiz submission, and streaming flows must be tested once those modules arrive.
