# Chess Wrapped release and rollback runbook

## Release rule

No candidate is release-ready solely because it compiles locally or displays on
one development device. Release approval requires the evidence below for the
exact candidate revision. A missing item is a documented waiver with an owner,
reason, risk, and follow-up—not an implicit pass.

## Candidate checklist

- [ ] Worktree is partitioned into reviewable, intended changes; generated
      files and secrets are excluded.
- [ ] Repository revision, mobile build/version, API revision, and dependency
      lockfile state are recorded.
- [ ] Required checks in [QUALITY.md](QUALITY.md) have passing evidence, or
      each waiver is approved and tracked.
- [ ] Relevant device/emulator evidence covers changed user-visible flows.
- [ ] Data-residency review confirms no raw game, PGN, token, eval-vault, or
      bulk personal analytics reaches API persistence or logs.
- [ ] Cache key/version, migration, and clear behavior are reviewed for any
      parser, metric, engine, phase, or serialized-state change.
- [ ] API CORS origins, credential behavior, endpoint compatibility, and
      error/log redaction are reviewed for the deployment environment.
- [ ] Development diagnostics and optional coach-model endpoints are disabled,
      gated, or explicitly approved for the target environment.
- [ ] A rollback target and the person authorized to use it are recorded.

## Release evidence record

Store this record in the release ticket, PR, or tagged release notes:

```text
Candidate revision:
Mobile build/version:
API revision/deployment target:
Scope and user-facing change:
Checks run (command, environment, result):
Runtime evidence (device/build/scenario):
Data/cache/privacy review:
Known waivers (owner, risk, due date):
Rollback target and procedure owner:
Approval (name/date):
```

## Rollback principles

1. Prefer redeploying the prior known-good API/mobile build over editing live
   data or clearing user storage.
2. Do not erase device data as a release workaround. If a cache incompatibility
   requires invalidation, ship the documented version/migration behavior.
3. Disable an unsafe optional remote integration before weakening local privacy
   or device-only behavior.
4. Record the trigger, candidate revision, action, impact, and follow-up in
   [AUDIT.md](AUDIT.md) or the release record.
