# Chess Wrapped quality and verification contract

## Current control status

A deterministic baseline gate is available:

```bash
cd mobile && npm ci && npm run verify
.venv/bin/python scripts/run_python_tests.py
```

The same mobile and Python checks run in `.github/workflows/verify.yml` on pull
requests and pushes to `main`. The gate uses lockfile-resolved `tsx` rather
than a transient `npx` download, rejects Python parser warnings, and blocks on
TypeScript errors. It is a static/fixture gate, not proof of device, network,
cache-performance, or production behavior.

## Evidence levels

| Level | What it proves | What it does not prove |
|---|---|---|
| Static | Source inspection, schema checks, type checks, local unit/fixture script results | Device rendering, native behavior, live network behavior |
| Runtime | An identified device/emulator/build displayed the observed behavior | General correctness on other devices/accounts |
| Integration | A deliberately configured service/provider exchange completed | Production resilience, privacy approval, or broad load behavior |
| Release | Approved checklist plus recorded evidence for the candidate revision | Future compatibility after dependencies/providers change |

Never describe a source edit or a static test as visual/runtime verification.
Do not use private production games, tokens, emails, or raw telemetry as test
fixtures or handoff evidence.

## Existing validation surfaces

| Surface | Current location | Evidence expectation |
|---|---|---|
| Python metric/baseline/API fixtures | `scripts/run_python_tests.py` | The runner rejects nonzero exits and unexpected stderr from every listed test |
| Mobile coach/metric scripts | `mobile/scripts/` | Use installed, lockfile-resolved tooling; record each script and fixture result |
| TypeScript | `mobile/tsconfig.json` | Run the project-local compiler and retain the full error summary; a failing typecheck is a release blocker unless explicitly waived |
| API contract | FastAPI routes and `/docs` | Verify only against approved local/staging data; redact request data in records |
| Visual behavior | Screen/component route plus app build | Attach redacted screenshot/video or documented manual result from an identified runtime |
| Lifecycle behavior | Scenarios in `MOBILE_DATA_LIFECYCLE_CONTRACT.md` | Record cold/warm/offline/filter/cache evidence for any related change |

## Required change evidence

For each change, record in the handoff, PR, issue, or release note:

1. Revision/commit or explicit uncommitted diff scope.
2. Requirement and owned components/files.
3. Commands and environment used, including dependency-install state.
4. Passing, failing, skipped, and unavailable checks—without presenting a skip
   as a pass.
5. Runtime evidence for user-visible/native/network changes, or a clear note
   that runtime verification was not performed.
6. Cache/data/privacy impact, including the relevant key/version or explicit
   statement that no persistent behavior changed.
7. Follow-up issue/owner/date for every waiver or known failure.

## Automation boundary

The current clean-checkout gate installs pinned dependencies and runs, without
network-downloaded transient runners:

1. Python fixture tests;
2. mobile TypeScript validation;
3. selected mobile fixture scripts through a declared local test runner;
4. selected API observability checks.

Generated-asset/schema, documentation-link, and generated-artifact checks are
still required release evidence but are not yet automated. Add a new test or
check to the gate rather than documenting it as a one-off command.
