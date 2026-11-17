# Shared foundation for team review

This is a proposed common base for the six-person team, submitted for review.
Review it with Abdallah before merging. Other members keep ownership of their
Auth, Catalog, Question, and Attempt modules. No duplicate models are defined.

## Start locally

Use Node.js 22.18 or newer. Run `npm ci`, then `npm run setup:env`. This creates
the local .env and replaces a missing or sample signing key with 32 cryptographic
random bytes encoded as 64 hex characters. Existing custom keys are preserved.
Startup rejects the placeholder, invalid key format, and obvious repeated keys.
Format and diversity checks cannot prove a key was randomly generated. To replace
an existing custom key, use `npm run setup:env -- --rotate-key`; this invalidates
existing tokens. Production keys must come from a cryptographic generator or a
trusted secret manager. Setup never prints the key. It writes a private temporary
file, flushes it, and renames it over .env. Files use mode 0600 on POSIX and a
restricted owner/SYSTEM ACL on Windows, including when preserving an existing key.
Set your MongoDB URL. Start MongoDB, then run `npm run dev`.
This builds and starts the server; it does not watch files. For later starts,
run `npm run build` and `npm start`. Open `http://localhost:3000/api/v1/health`.

Environment values are checked before connecting to MongoDB. Invalid fields stop
startup. Health returns 503 while the database or analytics worker is not ready.
JWT_EXPIRES_IN must be positive. Production forces verified MongoDB TLS, even
for a mongodb:// URI, and rejects URI options that disable TLS or certificate
verification. Plain loopback MongoDB is supported in development/test.
No user accounts, login route, or seed data are created by the shared foundation.
Protected routes require a valid token and an existing user document.

## Shared files

| Folder or file | Purpose |
| --- | --- |
| `src/config/env.ts` | Parse and validate environment values |
| `src/config/database.ts` | Connect and close MongoDB |
| `src/config/dashboard-adapters.ts` | Read existing users and quizzes for Dashboard |
| `src/common/errors/` | Shared HTTP errors |
| `src/common/middlewares/` | Error handler, validation, async wrapper, JWT and roles |
| `src/common/utils/` | Response envelopes, pagination, email port, shutdown |
| `src/common/telemetry/` | Event-loop monitoring and public health route |
| `src/common/workers/` | One long-lived analytics worker and bounded pending requests |
| `src/app.ts` | Express wiring, security headers, CORS, rate limit, API routing |
| `src/server.ts` | Startup, dependencies, signals, and resource shutdown |

## Agreement with module owners

- Auth issues HS256 JWTs with `sub`, `role`, `tokenVersion`, and `exp`. The secret
  must match the shared verifier. `JWT_EXPIRES_IN` is available for the Auth owner
  to use when issuing tokens. The foundation does not issue tokens.
- Users store role (`student` or `admin`) and numeric tokenVersion. Each protected
  request checks the current stored values, so logout or password reset can revoke
  tokens by incrementing tokenVersion. The Auth owner implements those mutations.
- Authentication is available through the returned `createAuth` object:
  `authenticate`, `requireRole`, and `principal`. It uses request-scoped storage
  and does not add conflicting global Express user declarations.
- Profile reads expect firstName, lastName, and optional avatarUrl. Collection
  names are configurable. Confirm these and the Attempt snapshot fields listed
  in `dashboard-contract.md` with the owning members.
- Add feature routers to `createApp` through `moduleRouters`; all mount under
  `/api/v1`. Each feature owner applies the shared auth and role middleware to
  their protected routes. Public login and recovery routes remain public.
- Use `validateRequest(schema, source, key)` for body, query, or params. Parsed
  values are in `res.locals[key]`; Express 5 query is not overwritten.
- Use shared error classes and response helpers. Unknown errors return a generic
  500 response. Details accept only public field paths and issue codes; messages
  are static and unknown fields are stripped. Server-error details are omitted.
- EmailSender is an interface for Auth to implement. No email provider or OTP
  logging is configured by this base.

## Runtime behavior

One worker starts with the server. Requests carry requestId, taskType, and payload.
The manager rejects work while starting or when the pending limit is reached.
The default worker queue limit is four pending jobs, with a separate limit of
two complete analytics requests admitted before quiz lookup or payload loading.
Quiz lookups and the entire analytics cursor each have a 5-second database
deadline. Cursor cleanup and admission release also run on timeout.
Each payload allows at most 100,000 question results, and pending worker jobs
share a budget of 200,000 question results. Timeouts terminate the stuck worker and
reject all its pending jobs. Error and unexpected exit do the same. A replacement
starts with bounded retry delay; old worker messages cannot resolve new jobs.
Calculation failures reject that job while keeping the worker alive. Timeouts,
calculation failures, and unexpected exits are reported through the operational
callback with safe error codes.

The default request timeout is 30 seconds. The worker protocol currently registers
`quiz-analytics`; future task types need explicit request and response contracts.
This is the one shared manager: modules should not create their own Worker.

Health reports event-loop delays in milliseconds, database status, and worker
readiness. Monitoring starts at bootstrap, not on each request. Measurements are
since process startup. SIGINT and SIGTERM stop HTTP admission and drain active
requests while workers and MongoDB remain available, then stop workers, close
MongoDB and stop monitoring. Repeated signals use the same guarded shutdown.
An unref'ed 10-second safety deadline remains armed even after cleanup fails;
it does not keep a clean process alive.
Successful cleanup clears the deadline. A later server error still changes the
exit code to failure even if shutdown has already started.

The API JSON limit is 100 KB. NDJSON streaming imports use a different content
type and are not consumed by the JSON parser. The global limit is 300 requests
per IP per 15 minutes per server process. Auth should add stricter login and OTP
limits. TRUST_PROXY is empty by default: forwarded client addresses are ignored.
For a real reverse proxy, explicitly list only its known IPs or CIDRs, for example
127.0.0.1/32,::1/128 for a same-machine proxy. Boolean blanket trust and implicit
hop counts and /0 CIDRs are rejected. Use a shared rate-limit store for multiple processes.
CORS uses the comma-separated origin list
in CORS_ORIGINS. Health is public and outside the API rate limit.

## Verification

Run `npm run verify` with local MongoDB available at 127.0.0.1:27017.
This runs Jest coverage, builds the project, checks real worker failures and
recovery, fixture-lock checks, then live integration scenarios through the server and MongoDB.
A unique temporary test database is removed after the integration run.

See `verification.md` for measured results, dependency audit findings, and scope.
Full login/logout mutations, other module flows, proxy settings, and performance
with the finished team project still need integration checks.

## Manual fixtures

Run npm run manual:seed to create a test student and three attempts and print a
one-hour local token. Run npm run manual:cleanup to delete only those marked
records. Both commands acquire the same exclusive lock across state-file and
database operations. A concurrent command fails without changing records.
If a process is forcibly killed, confirm that it has stopped before removing its
stale .local/manual-test.lock file and retrying. Local state and .env are ignored
by Git. Restart a running server after a signing-key change and generate a fresh
manual token; old tokens will no longer authenticate.
