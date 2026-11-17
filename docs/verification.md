# Local verification

Date: 2026-11-17

Scope: Dashboard and Analytics plus the shared foundation. Other members'
unfinished feature implementations are outside these results.

## Latest review checks

- npm run verify: passed.
- TypeScript strict checks and production build: passed.
- Jest: 149 tests passed across 15 suites.
- Collected coverage: statements 95.74%, branches 90.55%, functions 96.77%,
  lines 98.41%. Bootstrap, database connection and worker entry points also have
  dedicated boundary/live checks. Index creation is verified by live MongoDB;
  that separate process is not counted in Jest coverage.
- Real worker reuse, distinct concurrent results, idle exit, error, unexpected
  exit and timeout recovery: passed.
- Exclusive manual-fixture lock contention and release after failure: passed.
- Live integration: 32 scenarios passed using the real HTTP server, signed JWTs,
  local MongoDB, compound indexes, and the production analytics worker.

New integration checks cover oversized total question results, two admitted
analytics requests plus one rejected request, draining in-flight analytics before
stopping workers, repeated shutdown signals, rejected example signing keys, zero
token lifetimes, and production options that disable database TLS.

Each run uses a unique online_exam_check_ database and drops only that database
in cleanup. Fixture tests use temporary files; private local state is ignored.
The Windows child bridge emits signals inside the process; it does not claim to
test Windows OS signal delivery. The failed-cleanup deadline is tested with a
fake clock and injected cleanup failure, not by breaking real OS resources.

## Latest measured workload

- 5,000 attempts with 100,000 question results.
- Analytics request: about 729 ms.
- Health replies sampled during that request: 38.
- Slowest sampled health request: about 47 ms.
- Event-loop maximum delay: 43.22 ms; p99 delay: 27.12 ms.

The check requires the observed maximum to remain below 100 ms for this local
workload. These observations are not a guarantee for every machine or the
finished application. Concurrency and size limits bound accepted work.

## Review changes

See review-follow-up.md for all fifteen points and their regression checks.
An earlier review also fixed unknown API paths returning 401 instead of 404.

## Dependency audit and remaining integration

The latest runtime dependency audit reported zero known vulnerabilities. The
full audit has 18 moderate affected entries in the Jest development-tool chain,
rooted in glob/minimatch. No forced major-version downgrade was applied.

Production database TLS is verified at the configuration/driver boundary;
testing an actual TLS database and deployed proxy remains a deployment check.
Module owners must confirm stored fields, collection names, shared index names,
and feature contracts. Registration, login/logout mutations, recovery, catalog,
submission, and streaming flows need tests when those implementations arrive.

## Repeat locally

Run npm ci, npm run setup:env, then npm run verify. Local MongoDB must be available
at 127.0.0.1:27017 for live integration checks. setup:env generates a signing key
without displaying it. Restart a running server after a key change and create a
new manual token. npm run check:integration alone requires a current build.

No merge is performed by these commands.
