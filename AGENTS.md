# Chess Wrapped repository instructions

This is an independently governed nested repository. Its source and project
contracts commit here; do not place application source, runtime records, or
project contracts in the parent PIOS repository.

## Start here

1. Read [manifest.yaml](manifest.yaml), [ARCHITECTURE.md](ARCHITECTURE.md), and
   [README.md](README.md).
2. For mobile work, read [mobile/README.md](mobile/README.md) and then
   [mobile/AGENTS.md](mobile/AGENTS.md). The latter is the detailed coach
   behavior contract.
3. For ingest, storage, metrics, engine, or background-work changes, read
   [MOBILE_DATA_LIFECYCLE_CONTRACT.md](MOBILE_DATA_LIFECYCLE_CONTRACT.md) and
   [DATA_SPECIFICATION.md](DATA_SPECIFICATION.md) before editing.
4. Preserve unrelated worktree changes. Record validation and handoff evidence
   according to [QUALITY.md](QUALITY.md) and [TRACEABILITY.md](TRACEABILITY.md).

## Non-negotiable boundaries

- Raw games, PGNs, auth tokens, eval vaults, and bulk personal analytics stay
  on the device; do not add an API persistence path for them.
- Do not copy secrets, user caches, raw telemetry, or private game data into
  issues, fixtures, logs, external tools, or documentation.
- A cache-schema, metric, parser, engine, or phase-boundary change needs an
  explicit cache-version/migration review and an update to the lifecycle/data
  contracts when its behavior changes.
- A source edit is static evidence, not confirmation of a device result. State
  what was verified on an attached runtime separately from source/test proof.

## Change records

Update [DECISIONS.md](DECISIONS.md) for material architectural, privacy,
storage, dependency, or external-service decisions. Update the associated
contract when changing a declared invariant. Use [RELEASE.md](RELEASE.md) for
the release evidence and approval checklist.
