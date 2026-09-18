# Chess Wrapped ownership and decision boundaries

The registered Git identity `isaiapedro` is the repository owner. The parent
workspace owns routing and registry policy only; this nested repository owns
its implementation, assets, tests, and project contracts.

| Area | Accountable role | Required consultation / evidence |
|---|---|---|
| Product behavior and release approval | Repository owner | Release checklist and user-visible acceptance evidence |
| Mobile UI, local storage, and device privacy | Mobile maintainer | Lifecycle contract; static and runtime proof kept distinct |
| API surface and deployment | API maintainer | Privacy/CORS/logging review and compatibility evidence |
| Metric semantics and peer baselines | Metrics maintainer | Data Specification, fixtures/parity evidence, baseline provenance |
| Stockfish and coach pipeline | Analysis maintainer | Cache-version review, model/fallback behavior, sanitized fixture results |
| Repository controls and documentation | Repository owner | Manifest, decision record, audit/traceability update when material |

Roles may be held by one person, but the evidence boundary remains the same.
An unassigned role is not permission to make an irreversible privacy, release,
or external-service decision without repository-owner approval.

## Decision record threshold

Add a dated entry to [DECISIONS.md](DECISIONS.md) when a change affects any of:

- data residency, privacy, external provider, model, or telemetry policy;
- storage key/version, migration, metric formula, engine version, or cache
  invalidation behavior;
- API compatibility, authentication, production deployment, or rollback;
- ownership or required quality/release control.

The entry must state the decision, reason, alternatives, consequences, and
the validation or migration evidence. Routine copy, style, and isolated bug
fixes do not need an architectural decision record unless they cross one of
these boundaries.
