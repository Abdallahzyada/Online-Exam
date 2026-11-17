# Review follow-up

The following changes address the fifteen initial review points. They are on
the feature branch for team review. No merge is performed.

| Point | Change and verification |
| --- | --- |
| 1. Sample signing key | Reject placeholder/invalid/repeated keys; setup:env uses crypto.randomBytes. Startup and schema regression tests. |
| 2. Database transport | Production forces verified TLS and rejects disabling URI options. Unit test inspects the actual connection options; startup rejects plaintext options. |
| 3. Analytics memory | 100,000 results per job, two admissions before DB loading, 200,000 pending results overall. Repository, service, worker and real concurrent HTTP tests. |
| 4. Failed shutdown deadline | Unref'ed deadline stays armed after cleanup rejection. Fake-clock failure regression test. |
| 5. Repeated signals | Persistent signal listeners feed one guarded stop function. Repeated-signal unit test and child-process bridge. |
| 6. In-flight requests | Drain HTTP before stopping workers/database. Deferred unit test and live analytics shutdown test. |
| 7. Public error details | Typed public fields/codes, runtime allowlist, static messages, no server-error details. Sanitizer and HTTP regression tests. |
| 8. Reverse proxy | Explicit IP/CIDR trust configuration, safe default false. Forwarded-client tests with and without a trusted proxy. |
| 9. Token lifetime | Positive duration only; zero durations rejected by schema and real startup tests. |
| 10. Fixture concurrency | Seed/cleanup share an exclusive file lock for the complete operation. Real filesystem contention/failure tests. |
| 11. Query indexes | Sort before facet; named compound indexes created at bootstrap. Live MongoDB confirms both indexes and history ordering. |
| 12. Operational reporting | Timeout, exit/protocol failures and calculation errors call report. Unit test verifies timeout/calculation callbacks. |
| 13. ID casing | Normalize ObjectId strings before counting and duplicate detection. Mixed-case and duplicate regression tests. |
| 14. Reply correlation | Distinct requests/results in out-of-order unit and real-worker checks. Each promise must receive its own result. |
| 15. Validation leak test | Match the complete response and explicitly reject the submitted value. Public details also strip free-form messages and values. |

Production TLS is checked at the configuration/driver boundary, not against a
live remote TLS database. Proxy tests exercise address selection locally, not a
deployed load balancer. These deployment checks remain with the platform owner.
# Additional runtime checks

- Proxy configuration rejects /0 networks.
- Environment setup uses randomBytes, private file permissions, and atomic
  replacement. Explicit --rotate-key replaces an existing custom key; validation
  does not claim to prove its randomness.
- Public error messages and codes use a fixed allowlist; unknown codes are generic.
- Equivalent indexes from other modules are reused without dropping or renaming.
- Per-attempt question limits return ANALYTICS_LIMIT before schema parsing.
- Analytics cursor and quiz lookup have bounded database operations. Admission
  happens before either lookup, and cleanup releases capacity on failure.
- Successful shutdown clears its deadline; later errors preserve a failure exit.
- The integration shutdown check coordinates an accepted HTTP request through
  test-only IPC instead of relying on a 50 ms delay.
