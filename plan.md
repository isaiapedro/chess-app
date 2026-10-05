# Chess Wrapped — Governance Remediation Plan

## Audit status

**Status: not release-ready.** The Registry entry is structurally valid, but
the project does not meet the workspace requirements for privacy, security,
traceability, auditability, logging, or reproducible testing.

## Audit summary

| Area | Result | Evidence |
| --- | --- | --- |
| Registry | Partial pass | Registered as active `chess_app`, with an independent nested-repository boundary; root Registry validation passes. |
| Security and privacy | Fail | Public username/email registry, permissive CORS, plaintext debug telemetry, and weak filesystem permissions for secret and PII-bearing paths. |
| Traceability and auditability | Fail | Required local governance contracts are absent; the working tree is dirty and lacks a documented audit baseline. |
| Logging | Fail | Debug telemetry has no consent, redaction, retention, or access-control contract. |
| Testing | Fail | No CI, no reproducible test runner, a direct Python test failure, and TypeScript compilation errors. |
| Cache lifecycle and performance resilience | Fail | Durable analytics stores can outlive metric/engine changes without an enforced invalidation path; no lifecycle or performance benchmark is committed. |

## Findings

### P0 — Public PII exposure

`GET /api/v1/users` returns all stored usernames and email addresses without
authentication. `POST /api/v1/users/register` is likewise unauthenticated.
The API permits every origin through CORS, while enabling credentials.

**Required outcome:** eliminate public enumeration. Remove the list endpoint
unless a documented administrative use case requires it; otherwise require
strong server-side authentication and authorization. Apply an explicit,
minimal origin allowlist, rate limiting, request-size limits, and transport
security at the deployment boundary.

### P0 — Personal-data egress and debug telemetry

The mobile client sends game-derived coaching payloads to the API, including
moves, engine lines, tactical facts, and evaluation context. This is not
captured by the documented device-residency contract. Default debug telemetry
also sends usernames, FEN fragments, and engine data to an HTTP collector
derived from the Expo host.

**Required outcome:** disable telemetry in production; make diagnostics
opt-in, authenticated, encrypted, redacted, and retention-bounded. Document
every externally transmitted field, destination, purpose, legal/consent
basis, retention period, and deletion route. Keep coach processing on-device
unless the approved data-residency contract explicitly permits the server
workflow.

### P0 — Local secret and PII protection

The API `.env` file is mode `664`; `.cache` and `.cache/users` are mode `775`.
The user registry is stored as plaintext JSON. The Registry already classifies
`.env` as a secret path.

**Required outcome:** enforce owner-only permissions (`0600` for secret files,
`0700` for PII-bearing directories), document encryption-at-rest requirements,
and define backup, rotation, access, retention, and deletion controls for the
email registry.

### P1 — Remote executable dependency boundary

The mobile Stockfish WebView loads JavaScript and WASM from unpkg at runtime
and permits all WebView origins.

**Required outcome:** bundle or integrity-pin the engine assets, constrain
WebView origins and navigation, document dependency provenance, and add a
reviewable update procedure.

### P1 — Cache invalidation can silently reuse incompatible analytics

The app intentionally keeps heuristic rows, Stockfish/eval records, study
state, and per-game coach results for a long time. While some keys carry a
manual version suffix, the durable heuristic and eval stores do not encode the
metric algorithm, parser/phase-boundary, engine configuration, or source
schema that produced their values. A change to any of those can therefore
silently combine new aggregates with old per-game results. Cache writes also
swallow AsyncStorage errors, and raw-store merge/write operations are not
transactional.

**Required outcome:** establish a cache compatibility policy. Every persisted
artifact must have an owner, scope, schema/algorithm version, TTL, migration
or invalidation route, clear behavior, and test fixture. Bump the appropriate
key version (or migrate) whenever a serialized form, metric meaning, parser,
phase boundary, engine/version/depth, or source-normalization rule changes.
Do not treat a successful calculation as durable until storage failure is
visible or retried. Serialize writes per raw-game store if another writer is
introduced.

### P1 — Background scheduling does not fully implement its stated priority

The product documentation says background Stockfish waits for heuristic metrics
to finish. The implementation provides `waitForPrefetchGate`, but no caller
uses it. Global Stockfish does yield to explicit puzzle demand, but can overlap
the heuristic pass; it can also start before first ingest has populated the
device store and complete with no games to scan.

**Required outcome:** choose and document the authoritative scheduling policy,
then enforce it in code. The policy must guarantee that a valid warm cache
renders first, explicit user analysis/puzzles receive engine priority, a
completed ingest can schedule missed prefetch work, and cancelled/stale work
cannot write into a newer account or filter view.

### P1 — Performance is designed for, but not measured or regression-tested

The app has useful protections—local-first hydration, incremental ingest,
per-game stores, remeshing, request coalescing, and compute budgets—but no
committed measurements prove cold-start, warm-start, refresh, memory, battery,
network, cache-hit, or engine-scan behavior. Current coach-focused scripts do
not validate cache reuse or lifecycle correctness.

**Required outcome:** define representative low-end-device performance budgets
and collect a reproducible baseline for: cold authenticated load, warm offline
load, warm online load with no new games, one-new-game refresh, filter remesh,
coach-cache hit, and first engine boot. Add automated tests that prove no
platform pull, heuristic pass, or Stockfish scan occurs when a compatible cache
already satisfies the request. Treat a regression against approved budgets as a
release blocker.

### P1 — Missing governance and traceability contracts

The project lacks `manifest.yaml`, `BEHAVIOR.md`, `SYSTEM.md`, `SECURITY.md`,
`AUDIT.md`, `TRACEABILITY.md`, and a project-level `AGENTS.md`. The existing
`DECISIONS.md` is untracked. Registry tests contain no chess-specific
governance coverage.

**Required outcome:** add the local contracts, aligned with the root manifest
configuration matrix and the `chess_app` Registry entry. Include:

- data classification and domain-boundary rules;
- source-of-truth architecture and approved external services;
- an attribute-to-control traceability matrix;
- decision records for the server registry, LLM workflow, telemetry, and
  remote Stockfish loading;
- audit evidence, review cadence, accountable owner, and exception process;
- Registry tests for repository boundary, generated paths, secret paths, PII
  stores, and required local contracts.

### P1 — Working-tree audit baseline

The nested repository contains 34 modified/deleted tracked files and 12
untracked files. Tracked Python bytecode exists despite ignore rules.

**Required outcome:** establish a reviewed commit baseline, remove generated
artifacts from version control, define which samples may contain public or
synthetic game data, and record provenance and licensing for every retained
fixture, baseline, coach pack, and asset.

### P1 — Non-reproducible and failing quality gate

`unittest discover` finds no tests. `pytest` is unavailable, although Python
tests use pytest-style functions. Direct execution of
`test_opening_phase_metrics.py` fails. The mobile tests depend on `tsx`, which
is neither declared nor installed, and `tsc --noEmit` reports production
errors. No CI workflow or project test/lint script is defined.

**Required outcome:** declare and lock test tooling, repair the failing test
and TypeScript errors, add test scripts, and require CI to run:

1. Registry and contract validation.
2. Python unit tests through a declared runner.
3. Mobile unit tests through a declared runner.
4. TypeScript compilation, linting, and dependency-integrity checks.
5. Secret scanning, dependency review, and privacy/egress regression tests.
6. An authenticated API test suite that verifies PII cannot be enumerated.

## Sequenced execution plan

1. **Contain exposure:** disable `GET /users`, production debug telemetry, and
   unauthenticated PII registration until replacement controls are verified.
2. **Secure data paths:** correct filesystem permissions and establish the PII
   retention, deletion, and encryption design.
3. **Reconcile architecture:** decide whether coach-comment processing may
   leave the device; update implementation and residency contracts together.
4. **Make cached analytics trustworthy and fast:** implement cache
   compatibility/versioning, storage-failure handling, and the authoritative
   scheduler policy; establish cold/warm/refresh performance budgets.
5. **Complete governance:** add local contracts, Registry coverage,
   traceability, decisions, audit evidence, and logging controls.
6. **Restore quality gates:** declare tools, fix test/compiler failures, add
   CI, and preserve its results as audit evidence. Include cache lifecycle,
   scheduler, performance, and privacy/egress regressions.
7. **Release review:** review the clean nested-repository baseline, validate
   the Registry, verify the performance baseline, and obtain a
   privacy/security sign-off before deployment.

## Verification record

- Root Registry validation completed successfully: 41 components, valid.
- The `chess_app` Registry resolution confirms an active, independent nested
  repository with root exclusion and local `.env` / `mobile/.env` secret paths.
- Git integrity and whitespace checks completed without reported errors.
- No application or configuration behavior was changed by the audit.
