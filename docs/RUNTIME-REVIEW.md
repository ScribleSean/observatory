# Dependency and runtime review

Observed September 13, 2026 UTC. Source baseline `34856e3`. Installed development apps remain `30f91ca`, version 0.3.1. No runtime or package was changed by this review.

## Package advisory checks

The following completed successfully without dependency installation:

```sh
npm audit --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org --json
dotnet list native/windows/WorkspaceObservatory.csproj package --vulnerable --include-transitive --no-restore --format json
```

npm reported zero known vulnerabilities, with 698 dependencies in its metadata. The Windows NuGet query used `https://api.nuget.org/v3/index.json` and returned the project with no vulnerable entries. The existing restored Windows project was used, not a new clean restore. Public dependency metadata was queried, not usage records.

Lockfile SHA-256:

- `package-lock.json`: `830f259539103cc9b828cac288d3818d966e42e510fb69b2d3a1013538947846`
- `native/windows/packages.lock.json`: `da81446ea7bfe69b9216e393c5dea8e305bc66b43cae4a6afa88d44936ed615f`

## Installed runtime inventory

Versions were read from the installed executables, Python modules and Windows runtime metadata, not inferred solely from source pins.

| Component | Mac arm64 | Windows x64 |
| --- | --- | --- |
| Node | 22.23.2 | 22.23.2 |
| Python | 3.13.15 | 3.13.15 |
| Python OpenSSL | 3.5.8 | 3.0.21 |
| Python SQLite | 3.53.1 | 3.50.4 |
| .NET / Windows Desktop | Not used | 10.0.12 |
| WebView2 SDK dependency | Not used | 1.0.4191.47 |

The SDK version is not the installed system WebView2 Runtime version. OS WebKit and WebView2 security status remain unverified.

[Node 22.23.2](https://nodejs.org/en/blog/release/v22.23.2) is the July 29 security release. The inspected [Node vulnerability index](https://nodejs.org/en/blog/vulnerability) listed that as its newest security release. The Mac and Windows archive hashes in source match the hashes on that release page. Microsoft's [.NET 10 release metadata](https://raw.githubusercontent.com/dotnet/core/main/release-notes/10.0/releases.json) identifies 10.0.12 as its September 8 security release and latest runtime at this observation. These checks are dated, not guarantees against later advisories.

## Open findings before publication

Windows Python's OpenSSL 3.0.21 is in the affected version range for at least CVE-2026-75803, fixed in 3.0.22. The [OpenSSL advisory index](https://openssl-library.org/news/vulnerabilities/index.html) describes an empty-ciphertext authentication issue in particular EVP calls. An affected library version does not establish that Observatory invokes the vulnerable path. Applicability and the other August findings still need review. Do not mark the bundled runtime cleared by npm or NuGet results.

Windows Python's SQLite 3.50.4 predates the [WAL-reset fix](https://sqlite.org/wal.html#the_wal_reset_bug), available in 3.51.3 and later and backported to 3.50.7. The issue requires concurrent WAL writing or checkpointing. Inspection found that Observatory's Python settings cache requires DELETE journal mode, while its Wispr reader opens the source database read-only and enables query-only mode. No corruption was observed or reproduced. This limited path review is not a full SQLite assessment. Mac's 3.53.1 also has later maintenance fixes in the [SQLite release history](https://sqlite.org/changes.html).

Next: select a supported, checksum-pinned Python distribution with patched dependencies, verify architecture and license notices, then run both platforms' reader, cache and paired-store tests before rebuilding packages. Do not replace DLLs inside the running installation or modify another application's source database as a shortcut. Recheck installed versions after deployment.

Package-feed checks do not audit application logic, native bridge permissions, operating systems, all bundled transitive libraries or clean-machine behavior. The final release security gate remains open.

## Isolated Windows replacement probe

The official [Astral September 1 release](https://github.com/astral-sh/python-build-standalone/releases/tag/20260901) provides `cpython-3.13.15+20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`. Its GitHub release-asset SHA-256 is `63d263ab0162f34a241a56dc5b283c22d6e131f5516117e6a921350c69ba7d4f`, and its size is 21,936,514 bytes. The downloaded archive matched before extraction and execution in a separate test directory.

The candidate reports AMD64, Python 3.13.15, OpenSSL 3.5.8 and SQLite 3.53.1. Those dependency versions include the two fixes identified above, but this is not a complete advisory clearance. It is not installed and the Windows release pins are unchanged.

The initial focused run passed 7 of 14 tests and failed 7 because timezone data was absent. After extracting the installer's existing checksum-pinned tzdata 2026.3 wheel into the candidate's `Lib/site-packages`, the isolated timezone check and all 14 focused tests passed. These cover runtime selection, Wispr numeric-only reads and date boundaries, token settings, private-event filtering, and cache reuse, append and truncation. The same tests passed with the installed Mac Python. Tests use synthetic data only.

Use `OBSERVATORY_TEST_PYTHON` with an absolute executable path to repeat these checks against a candidate instead of the system launcher:

```sh
node --test scripts/test-python.test.mjs scripts/wispr.test.mjs scripts/read-settings.test.mjs
```

Remaining before adoption: inventory dependency licenses and runtime contents, preserve isolated Python startup behavior, account for the different archive layout and timezone location, inspect unpacked size, then verify packaged collection and native lifecycle. Do not treat this reader-only probe as installer or upgrade verification.
