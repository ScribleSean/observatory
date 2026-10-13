# Archive

On 2026-10-13 the repository was cleaned up for the shared web viewer direction described in [the design direction](DESIGN.md). The state of `main` before that cleanup is kept at the Git tag `archive/pre-web-direction`.

Nothing in the archive describes the current app. It is kept so that earlier decisions and evidence can still be read.

## Removed from `main` and kept at the tag

| File | What it was |
| --- | --- |
| `docs/RELEASE-0.3.8.md` to `docs/RELEASE-0.3.13.md` (five files) | Dated release and installation evidence for builds 14 to 36 |
| `docs/AUDIT-STATUS.md` | Audit follow-up and open acceptance criteria as of October 7 |
| `docs/UI-VERIFICATION.md` | Dated checks of the SwiftUI and Windows Forms interfaces |
| `docs/ARCHIVE-SAFETY-2026-10-05.md`, `docs/NATIVE-CLEANUP-2026-10-04.md` | Reviews of the WSL and Ubuntu source retirement |
| `docs/MAC-MIGRATION.md` | Assessment of the legacy Mac hub configuration |
| `docs/PROVIDER-COVERAGE-HANDOFF.md`, `docs/USAGE-TRACKING-REFERENCES.md`, `docs/TRACKING-REUSE.md` | Research notes on other usage trackers |
| `docs/RUNTIME-REVIEW.md` | Review of the bundled runtimes for an earlier build |
| `scripts/login-jobs.mjs`, `scripts/mac-migration-config.mjs`, `scripts/mac-migration-plan.mjs`, `scripts/read-local-model.py`, `scripts/check-public-demo.mjs`, `scripts/build-windows-icon.mjs` and their tests | Scripts that no app, build or workflow referred to |

Where a current document mentions one of these, the text now says "(archived)" in place of a link.

## How to read an archived file

```sh
git show archive/pre-web-direction:docs/AUDIT-STATUS.md
```

## Also removed that day

- Ten merged `shared/` branches and five older local branches whose commits were already in `main`.
- On the owner's Mac, old update folders, old app copies and a build cache were moved to the Trash. They were never part of the repository.
