# Chess Wrapped traceability contract

## Scope and evidence boundary

Traceability connects a requirement to its source change, verification, and
release decision without copying private account data. The repository must be
able to answer: what changed, why, which contract applied, what evidence was
obtained, and what remains unverified.

| Change class | Primary trace | Required companion record |
|---|---|---|
| UI or navigation | target screen/component → manual runtime evidence | Build/device/scenario and visual acceptance result |
| Ingest, cache, filters, metrics, engine | owner module → lifecycle/data contract | Key/version/migration review and fixture evidence |
| API endpoint or proxy | router/service/schema → API description | Compatibility, privacy, CORS, and redacted integration evidence |
| Coach/model behavior | game-coach module → `mobile/AGENTS.md` | Payload/fallback review and sanitized fixture output |
| Release/process/documentation | manifest/contract/decision | Checklist, audit entry, and link validation |

## Required links for a material change

Each material change must identify:

1. Requirement or issue/reference.
2. Owning component and changed paths.
3. Relevant contract(s) and any decision record.
4. Test/static/runtime evidence, labeled by level from [QUALITY.md](QUALITY.md).
5. Privacy and persistence impact.
6. Candidate revision and release/rollback record where applicable.

If an external tracker is unavailable, use a dated section in
[AUDIT.md](AUDIT.md) and reference the commit/revision. Do not create a false
link by inventing a passing test, user approval, production observation, or
incident resolution.

## Canonical map

| Question | Authority |
|---|---|
| What is this repository allowed to store? | [manifest.yaml](manifest.yaml), [README.md](README.md) |
| Who may decide/release what? | [OWNERSHIP.md](OWNERSHIP.md), [RELEASE.md](RELEASE.md) |
| How does mobile data move and invalidate? | [MOBILE_DATA_LIFECYCLE_CONTRACT.md](MOBILE_DATA_LIFECYCLE_CONTRACT.md) |
| What does a metric mean? | [DATA_SPECIFICATION.md](DATA_SPECIFICATION.md) |
| How do agents locate code and distinguish static/runtime truth? | [mobile/AGENT_ONBOARDING.md](mobile/AGENT_ONBOARDING.md) |
| What quality evidence is required? | [QUALITY.md](QUALITY.md) |
| What is currently known/open? | [AUDIT.md](AUDIT.md) |
