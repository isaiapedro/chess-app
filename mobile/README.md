# Chess Wrapped mobile client

This directory is the Expo SDK 57 mobile client. It owns the app interface,
device-side account state, direct platform ingest, local analytics, Study
queues, and local engine/coaching orchestration. It does not own server-side
storage for games, PGNs, tokens, eval vaults, or bulk personal analytics.

## Start and navigation

```bash
cd mobile
npm install
npm run start
```

Run the FastAPI service from the repository root when API-backed explorer,
baselines, registration, or optional coach-comment behavior is needed. Keep
`EXPO_PUBLIC_API_URL` unset for the documented Metro development route unless a
deliberate environment configuration says otherwise. See the root
[README](../README.md) for service setup.

The source-defined tab order is Wrapped, Games, Study, Insights, and Profile.
For the composition tree, component ownership, static/runtime boundary, and
task traces, read [AGENT_ONBOARDING.md](AGENT_ONBOARDING.md).

## Required reading by change type

| Change | Read first |
|---|---|
| Any mobile implementation | [AGENTS.md](AGENTS.md), [AGENT_ONBOARDING.md](AGENT_ONBOARDING.md) |
| Cache, ingest, filters, analytics, engine | [../MOBILE_DATA_LIFECYCLE_CONTRACT.md](../MOBILE_DATA_LIFECYCLE_CONTRACT.md) |
| Metrics, phases, baselines | [../DATA_SPECIFICATION.md](../DATA_SPECIFICATION.md) |
| Privacy, test evidence, release scope | [../QUALITY.md](../QUALITY.md), [../RELEASE.md](../RELEASE.md) |
| Overall repository structure | [../ARCHITECTURE.md](../ARCHITECTURE.md) |

## Verification expectation

Use project-installed, lockfile-resolved tooling and record the exact command,
fixture, and result. A source edit or TypeScript/static result does not prove
that Expo displayed the result on a device. For visible or native behavior,
record a redacted device/emulator/build observation separately. Run
`npm run verify` for the lockfile-resolved mobile typecheck and smoke gate; CI
runs it for pull requests and pushes to `main`. See
[../QUALITY.md](../QUALITY.md) for required handoff evidence and its limits.
