# Native cleanup verification, October 4, 2026

This is historical evidence. See the [October 7 source status](AUDIT-STATUS.md#published-source-october-7) for later publication. The results and acceptance hold below describe the October 4 candidate, not today's source or installed apps.

This records a local, uncommitted candidate,
based on `4ad5bbc6bcb3daab16eaa8361f0f418de14864ea`. The source retains
`0.3.13` build `36` in `native/Release.props`. That is a source identity, not a
claim about either installed application.

The changes were not committed, published or installed. Verification used
fictional records. Existing configurations, source logs, installed apps and WSL
workloads were left unchanged.

The [October 5 archive review](ARCHIVE-SAFETY-2026-10-05.md) records later findings
and pending fixes. The verification results below retain their October 4 scope.

## Acceptance hold

Do not activate this retirement against real records yet. The broader review of
snapshot archive I/O and permission safety did not return an approval. Passing
archive regressions and the separate empty-observation review do not close that
gate. Installed collection and recovery acceptance also remain open.

## Source changes

- Native Windows and Mac collection, active device filters and new pairing
  requests exclude WSL and Ubuntu tracking. Saved legacy settings remain readable.
  An old WSL allowance selection is rejected instead of silently switching to a
  native account. The legacy Mac launch uses bundled scripts with its retained
  private runtime.
- Native history withholds old Ubuntu-inclusive totals and malformed aggregate
  provenance. It never substitutes an unverified Mac/Windows sum. Retained valid
  Ubuntu records have an `Archived Ubuntu` label, keep their original identifier,
  and remain read-only without an active Refresh or setup path.
- Private ancestry evidence from retired sources can still disqualify overlapping
  native sessions. Missing parents, incomplete inventories and positive usage
  hidden behind empty retained profiles cannot establish disjointness. Retired
  counters do not enter current native totals.
- Full snapshot replacement preserves exact prior retirement evidence in
  `.runtime/private-repair/retirement-snapshot.json` with a receipt. Successful
  empty observations and dated unavailable observations are evidence too.
  Matching retries retain the same two-file checkpoint. Conflicting or damaged
  checkpoints require inspection. The acceptance hold above still applies.
- Windows sharing captions and Collection-card sizing now respond to layout
  changes. Collection controls have semantic accessible names. Mac chart dates
  are spaced for the displayed size, and captures use the matching appearance.
- ChatGPT Dictation is explicitly unimplemented rather than an active choice.
  Wispr readings retain their device scope and missing-value distinctions.
  Combined voice time is not computed. Windows Agents copy explains receipt
  coverage without implying unsupported collection.

## Final Windows checks

The final run used pinned Node `v24.21.0` and the existing private .NET toolchain.
Its source diff was unchanged during execution.

| Check                                                | Result                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| All 120 shared test files                            | 759 cases, 695 passed, 64 skipped, no failures or cancellations.   |
| Native source contracts                              | 10 passed.                                                         |
| Windows Release build and complete native self-tests | Passed. The build reported no warnings or errors.                  |
| Native aggregate-provenance matrix                   | All 156 cases passed. These also run within the native self-tests. |
| Dashboard, usage popup and setup wizard fixtures     | Each returned its explicit pass marker.                            |
| TypeScript, web build and native web build           | Passed.                                                            |

The shared run includes all three permission-heavy batches in isolation:
`peer-pairing.test.mjs`, `peer-tls-client.test.mjs` and `quota-tls.test.mjs`.
The 64 skips were reconciled with their recorded test names. Four are narrowly
scoped Windows file-symlink `EPERM` capability skips. Directory-link, malformed
input and ACL assertions still run.

Independent reviews passed for the UI repairs, source-coverage copy, ancestry
correction, native provenance correction and test-fixture changes. The ACL helper
now runs one PowerShell command with explicit failure exits. Real negative
controls reject missing grants, owner mismatches and inheritance mismatches
without emitting a success marker. The production ACL script was not changed.

## Actual Mac checks

The native candidate compiled all 50 top-level `native/*.swift` files on macOS
27.0.1 arm64, using Swift 5 mode and the installed SDK 26.5. SDK 27 was not retried
because of the previously observed macro-tool mismatch.

A confined, unoptimized model harness passed the same 156 provenance cases and
the archived-history assertions. Its only test-file substitution moved the
Foundation temporary directory into the owned fixture root. Required dependency
declarations were byte-identical copies from source. Original production files
and assertions were unchanged.

The guarded preview refused all 9 unsafe launch cases, produced 38 fictional
images and passed 12 chart regressions. Source manifests and executable hashes
were checked, and the model, launch guards and chart checker were rerun
independently. These are not normal full-app or installed-app results.

The final shared and receipt-workflow run had 95 cases. The original confined run
passed 94 and failed the receipt subprocess case. Direct reading and the same
worker with piped stderr succeeded. A disclosed test-only adapter changed only
that worker's ignored stderr to a drained pipe, after which all 95 cases passed
with no skips. The product files and confinement profile stayed unchanged. The
original failure and instrumented result are both retained.

Mac fixture processes had isolated homes and temporary directories. Network
access, real user-data reads and writes outside the owned cache root were denied.
Before and after manifests matched all 558 uploaded source files. No provider
queries or installed-app launches were used.

## Lint and formatting

The clean Windows baseline has 83 lint errors and 388 formatting-failing files.
The candidate initially added 7 lint errors and 7 unformatted code files. Those
new issues were corrected and independently reviewed.

The final full checks still exit nonzero with the same 83 lint errors and the
same 388 formatting-failing files as the baseline. Diagnostic multiset comparison
found no new lint errors. All seven new code files pass formatting checks. No
checks were suppressed, unrelated files reformatted or Git settings changed.

## Evidence identity

These fingerprints identify the tested code before this report and its ledger
links were added. Documentation checks are separate from the build results.

| Evidence                                   | SHA-256                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Final Windows binary-formatted source diff | `282c9a427e421602443db6cf94e99864d6930549c7e045339d28831c6d1d41ec` |
| Final shared Mac source archive            | `204b298571cf164b3d73b42b5da47c18778a91984828e626cd7bc427095b32cd` |
| Native Mac candidate source archive        | `1585847096cb2edb08a36a5fe1870a330d5d8b574c6879f361aabd5ef62decbb` |

The native archive predates the final JavaScript cleanup. Its 50 top-level Swift
files were compared with the integrated source and matched exactly.

Local evidence remains outside Git in
`native-cleanup-2026-10-04-evidence.zip`. The bundle retains the tested source
archive, local working-tree patch, logs and verification records. The artifact names are
`observatory-resumed-verification-20261004-201949/summary.json`,
`observatory-native-scope-mac-verification/download-verification.json`,
`observatory-quality-shared-mac-verification/stderr-adapter-summary.json` and
`observatory-quality-cleanup/comparison.json`.

## Remaining work

- Obtain the missing archive I/O and permission-safety approval before real
  retirement or app replacement. Windows file flushing does not establish
  directory durability or power-loss recovery.
- Verify the exact installed candidate on both devices, including scheduled
  collection with the window closed, sleep/wake, startup, offline recovery and
  recoverable replacement. This work changed no installed target.
- Complete the open keyboard, screen-reader, motion, scaling and every-control
  interaction checks. Semantic names and synthetic captures do not close them.
- Keep signing, packaging, clean-machine and distribution claims separate. No
  release or installer acceptance was performed here.
- Address existing lint and formatting debt separately rather than expanding
  this repair into a repository-wide rewrite.

The older [audit record](AUDIT-STATUS.md), [UI evidence](UI-VERIFICATION.md) and
[release checklist](RELEASE-CHECKLIST.md) retain their original dates and limits.
