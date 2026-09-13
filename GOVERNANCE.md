# Chess Wrapped governance contract

## Authority and boundary

Chess Wrapped is an independently governed nested repository registered as
`chess_app`. Its implementation, assets, tests, and project contracts commit
here. The parent workspace provides Registry routing and policy, not a shared
commit boundary for this codebase.

The repository’s primary data rule is device residency: raw games, PGNs, auth
tokens, eval vaults, and bulk personal analytics must not persist through the
API. The API may handle only the limited shared data described in
[manifest.yaml](manifest.yaml) and [README.md](README.md).

## Required project controls

| Control | Authority | Required action |
|---|---|---|
| Repository identity and interfaces | [manifest.yaml](manifest.yaml) | Keep paths, component ownership, and Registry reference current. |
| Architecture and behavioral invariants | [ARCHITECTURE.md](ARCHITECTURE.md), [MOBILE_DATA_LIFECYCLE_CONTRACT.md](MOBILE_DATA_LIFECYCLE_CONTRACT.md) | Update the applicable contract when a declared invariant changes. |
| Metric meaning and cache compatibility | [DATA_SPECIFICATION.md](DATA_SPECIFICATION.md) | Review key/version/migration behavior for semantic or serialized-data changes. |
| Material decisions | [DECISIONS.md](DECISIONS.md) | Record privacy, storage, API, dependency, release, and external-service decisions. |
| Verification and release | [QUALITY.md](QUALITY.md), [RELEASE.md](RELEASE.md) | Preserve command/runtime evidence and do not represent waived checks as passes. |
| Auditability | [AUDIT.md](AUDIT.md), [TRACEABILITY.md](TRACEABILITY.md) | Record known control gaps, their owner, and closure evidence. |

## Change and review rules

1. Preserve unrelated worktree changes and keep commits reviewable by concern.
2. Treat secrets, user records, caches, raw games, and diagnostics as private;
   never copy them into documentation, fixtures, external tools, or commits.
3. Before adding a persistent store, remote request, model/service dependency,
   or telemetry path, document its owner, retention, residency, failure mode,
   and validation evidence.
4. Before a release, complete or formally waive the checklist in
   [RELEASE.md](RELEASE.md). Privacy, cache migration, and rollback decisions
   require repository-owner approval.

This contract describes required controls; it does not claim that every
control is already automated or passing. The current control baseline is in
[AUDIT.md](AUDIT.md).
