# Archive safety review, October 5, 2026

This is historical evidence. See the [October 7 source status](AUDIT-STATUS.md#published-source-october-7) for later publication. The findings and pending gates below retain their October 5 scope.

Live retirement and installed-app replacement remain on hold. The transaction
review passed, but the filesystem review found two missing policy checks.
Candidate fixes remain in isolated worktrees. The Mac verifier has scoped
approval, and corrected Windows candidates now pass selected real filesystem
fixtures. Independent review of the latest corrections, source-tree integration
and bundled-runtime verification remain open. No candidate changes have been
integrated into the main application working tree.

This follows the [October 4 cleanup record](NATIVE-CLEANUP-2026-10-04.md).
The review used base `4ad5bbc6bcb3daab16eaa8361f0f418de14864ea` and the five-file
archive/collector patch with SHA-256
`a7935a0bf8970b507e4cb5bb365d46c1de2eab6a57ae144ee976d760211677fd`.
That digest identifies the reviewed patch, not the whole working tree or an
installed application.

## Transaction and recovery review

Independent transaction review found no blocking data-integrity or
failure-reporting defect within the caller-owned collection-lock contract.
Full replacement waits for exact archive and receipt verification. Repeated
attempts reuse matching evidence. Corrupt, partial or conflicting checkpoints
stop replacement without overwriting the retained evidence.

The parent replay passed 19 existing transaction cases and eight additional
scratch-only I/O-failure cases. A separate replay of the reviewer's nine
assertion groups also passed. That harness replaced permission management and
unrelated collection dependencies with inert fixtures. It does not establish
filesystem permissions, installed-wrapper behavior or Mac execution.

The review also reproduced a recovery limitation. If full replacement fails
after preservation and a later quota-only refresh changes the saved snapshot,
subsequent full retries reject the conflicting checkpoint. Both snapshots remain
intact, but recovery requires inspection. This is a documented fail-closed case,
not automatic recovery or a silent loss of records.

## Filesystem blockers

Independent static review withheld approval for these reasons:

- **FS-1:** Canonical paths and a private leaf directory do not establish trust
  in every containing directory. If another local account can replace a parent,
  the current pathname-based write can place bytes elsewhere before the final
  validation rejects it. Windows file creation can inherit permissions from the
  substituted destination.
- **FS-2:** macOS owner and mode-bit checks do not inspect extended ACLs.
  Additional or inherited grants can provide access that those checks miss.

These are conditional source findings. The review did not inspect installed
runtime permissions, alter access controls or demonstrate exposure of actual
user records. Keeping the original snapshot after an error does not by itself
prove that no archive bytes were written elsewhere.

The fixes must reject unsuitable existing permissions before writing private
content. They must not silently repair permissions or weaken runtime bindings.
The process account and platform administrators remain trusted. Supported
filesystem assumptions and limitations must be explicit.

## Initial isolated candidate verification

The corrected Mac helper passed 60 synthetic cases on Windows Python 3.13.3
and again under confinement on Mac Python 3.14.4. Six unmodified CLI cases and
four sandbox controls passed on the Mac. Source and support hashes were checked
after execution. Sandbox rules matched the earlier run except for the new owned
fixture-directory path.

The first real Mac run rejected otherwise suitable fixtures because ancestor
directory handles requested read access. An `O_EVTONLY` diagnostic also failed.
The correction uses `O_SEARCH` for ancestor traversal and opens a readable
handle only for bounded enumeration of the private leaf. No ancestor read
permission was added to the sandbox. This verifies the exercised helper, not
the bundled Python 3.13 runtime or an installed collector.

The candidate's Python tests were moved out of packaged collector scripts and
registered through the standard Node test entry points. The discovery and
packaging regressions failed before that change and both passed afterward.
The relocated suite still runs all 60 cases. Focused modeled boundary tests
and the discovery wrapper passed 26 cases. The new JavaScript test files passed
formatting and the repository's type-aware lint rules.

The initial Windows candidate passed 43 modeled cases, but real scratch-directory
checks failed at ancestry preflight. Early read-only diagnostic requests expired
without execution confirmation. Those failures remain part of the evidence.
The follow-up below records the later approved diagnostic and corrected tests.
No existing permissions were repaired.

## Independent Mac verifier review

Independent review approved the corrected four-file Mac verifier scope with
no blocking security or logic findings. It checked the Darwin declarations,
allocation ownership, ACL iteration and flag handling against public Apple
sources. The reviewer independently passed the supplied 60 synthetic cases and
12 additional probes.

The reviewed helper SHA-256 was
`6cad76112e1c6e088fcc24d67f56712f17a082be027525db4d40f011ed747b7f`.
The integration candidate subsequently corrected one broken source-reference
URL in its module documentation. That correction does not change executable
behavior. The reviewed source remains separately retained.

This approval does not cover Windows policy, installed applications, bundled
Python compatibility or overall migration. It also excludes the later test
discovery and packaging layout changes, which have their own recorded checks.

## Follow-up verification on October 5

The parallel review used a frozen 566-file source archive with SHA-256
`7d8e16ad8e225d547f68fd259c67ecad658832c756c080dc6d9f5864734f48d7`.
Its archive-policy delta is
`f95b7b6f56c3482217759041643c9d96327e2b4ee16f7456d19b4a1444071ab2`.
Later corrections have separate patch identities. These are source candidates,
not new application builds.

### Windows ancestry and real fixtures

After renewed user approval, the read-only diagnostic executed. The original
helper failed ancestry validation. A generic-rights correction passed on the
same directory and received scoped static/model approval.
This did not establish creation and reuse on newly created directories.

Fresh fixtures exposed a second false rejection. Their protected DACL granted
full control to `OWNER RIGHTS`, SYSTEM and Administrators, and the current
account owned the directory. The correction resolves `S-1-3-4` against the
already validated owner during ancestry checks. It does not add that identifier
to trusted-owner or private-leaf account lists, or change existing permissions.

Parent verification of the corrected helper recorded these separate results:

| Check                                                                | Result                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| In-memory Windows policy tests                                       | 71 passed.                                                          |
| Guarded JavaScript boundary models                                   | 24 passed, with zero native-spawn or permission-operation attempts. |
| Real fictional-directory creation/reuse and child-environment checks | Both selected cases passed.                                         |
| Real fictional archive and collector cases                           | 25 passed, zero failed and three Mac-only cases skipped.            |
| Targeted lint and formatting                                         | Both passed.                                                        |

The native run excluded permission-mutation and directory-substitution cases,
including the mixed invalid-source group. Its command record lists the five
excluded top-level names. Repeated runs and nested cases are not additional
unique coverage. Source hashes stayed unchanged and fixture cleanup completed.

The generic-rights patch is
`beb194693507f13602c4fac1d37dfc20081977fc3a3b8ed04540b1c64e265ffb`.
The subsequent OWNER RIGHTS patch is
`76c8b2a53ef127fbcf939f2f2d9f50d3a7504a07ebeda6828eadedb40a087bcf`.
The tested helper is
`42ba916c9ce753936a69887b8d5923def2fffff98b3a4805551ccf9a47957eca`.
Independent review of that last correction remains pending.

One initial review harness retained Node's native custom promisifier through a
mock and may have launched read-only helper checks at a synthetic path. The
recorded run failed before initialization. Its actual native ACL-read reach is
Unknown. That run is retained and excluded from modeled evidence. The corrected
models explicitly prohibit native process launches.

### Mac caller integration and pinned runtime

The real JavaScript-to-Python path passed under confinement with 36 JavaScript
cases, the 60-case Python suite and four sandbox controls. The Python suite was
also reached through its Node discovery wrapper. That repeated execution is not
another set of 60 unique cases. The selected run excluded four top-level
permission/substitution cases and one nested directory-substitution case.

This run used Node 25.2.1 and Python 3.14.4, not the complete pinned runtime.
Parent readback verified 48 retained artifacts, all 566 remote source files and
an empty fixture HOME. The fictional original and retained snapshots matched
byte for byte. No ancestor directory-content access was added to the sandbox.

The expected Mac Python is CPython 3.13.15, build `20260901`. A first locator
check found no documented Mac cache path. The exact pinned Python archives were
then found in an existing Windows build cache and matched their source hashes.
Confined testing of that pinned runtime is pending. No download or installation
was needed to resolve the cache location. This does not establish bundled-runtime
or installed-app compatibility.

### Source entry points and quality checks

Independent JavaScript review identified two integration regressions. The Ubuntu
demo workflow still requests the full suite even though private-directory
operations now require a native platform. Source-tree collection and Mac tests
also need the selected absolute Python interpreter passed explicitly. Separate
corrections remain outside the accepted combined candidate. Production refusal
on unsupported platforms must not be weakened to make a workflow pass.

The quality review found one new lint error in the Python-path NUL regex.
A one-line correction keeps explicit NUL rejection outside that regex. Targeted
lint, 24 guarded caller cases and a 262,168-case predicate matrix passed.
With equivalent dependency resolution, the full diagnostic multiset matches
the 83-error baseline, with no added or removed diagnostics. An earlier run
without dependency types is retained but excluded from that comparison.
The correction patch is
`89a752270d95c7069d338a1f401621b6a561e9ae7343a7281d14f2746e4c9d25`.
Independent review remains pending. Existing formatting failures are not proof
that every edited line is formatted correctly.

## Evidence and acceptance limits

Local review evidence is outside Git under
`observatory-archive-review-continuation`, including transaction replay logs,
the added-line scan and the reviewed patch. Mac helper evidence is under
`observatory-mac-acl-verification` and `observatory-mac-acl-search-verification`.
Earlier source/build evidence retains its original October 4 scope.

The later command records, patches and results are retained locally in
`archive-follow-up-2026-10-05-1709-r2.zip`. Earlier bundles and their dated limitations
remain unchanged.
No new application build, installation, real-data migration, existing-permission
repair, commit or push is recorded by this review.

Acceptance still requires the remaining correction reviews, the separate
discovery/packaging-glue review, an exact combined source candidate and its
affected Windows/Mac checks. Pinned-runtime compatibility, installed collection,
recovery and native interaction/accessibility remain separate gates. This record
does not authorize installation, live retirement or publication.
