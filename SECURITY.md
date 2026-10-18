# Security and privacy

This is an early local-first desktop application with an optional static browser view. Do not expose the browser server to a network or host builds containing personal data. No browser-server authentication or multi-user authorization is implemented. Local processes with filesystem access remain in the trust boundary.

Cross-device transport is verified only for the existing SSH pairing. The installed Mac and Windows apps were re-paired over SSH on October 13, 2026, and the Mac reads fresh Windows records, as recorded in [the state record](docs/STATE.md). Pairing through Tailscale with a pasted invitation has passed only in the synthetic two-device test harness (P1-4, October 16, 2026), with temporary runtimes and synthetic records. That run had intermittent dropped connections whose cause is still open. Tailscale pairing between installed apps is not verified until the installed-app check (P1-6) passes on both devices.

Use `npm run serve:local`, not a Vite development server, for ongoing viewing. It serves the built shared viewer from `.native-build/web` through Node built-ins, with no framework server functions or image upload and processing paths. The server accepts only loopback requests with an allowlisted Host, rejects cross-site requests, and does not execute commands.

The native applications load the bundled shared viewer in system WebKit or WebView2, not from a development server. Native bridges and collectors still have their own permissions and input-validation boundaries.

## Dependency review, October 18, 2026 UTC

This review is for the build 43 release. It covers `package-lock.json` on `main` at `8470ab2`, SHA-256 `5cc3d38091278545052e369f5b8cacb5f19e02dc2f1bd2eeebee47bc419b36f6`. The lock file is byte-identical at `02555e8`, the build 43 source revision. Nothing was installed or updated. The commands ran on the Mac with npm 11.19.0 and Node 24.21.0:

```sh
npm audit --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org --json
npm audit --package-lock-only --ignore-scripts --omit=dev --registry=https://registry.npmjs.org --json
```

These submit public dependency metadata to npm, not usage records. The full tree has 106 packages, of which 5 are production entries (the project and four packages). The production-only audit reported zero advisories. The full audit reported three, all in development tools:

| Package | Severity | Advisory | Reached through | Ships in an app |
| --- | --- | --- | --- | --- |
| tinypool 2.1.0 | Critical | [GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3) and [GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr), prototype pollution in worker options leading to code execution | oxfmt 0.61.0, the code formatter behind `npm run format`. npm also lists oxfmt itself as affected through tinypool. | No |
| source-map-js 1.2.1 | High | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), event-loop denial of service from crafted indexed source maps | postcss 8.5.28, used by Vite 8.2.2 at build time | No |

Neither path ships. The formatter and the bundler run only on a developer or CI machine, against the repository's own files. Neither app runs them. The Mac build 43 ZIP contains no `node_modules` folder, and the Windows package check (`native/windows/package-content.mjs`) refuses one. The viewer bundle notice, which is generated from the modules rendered into the emitted chunks, names only the four production packages below. Updating oxfmt (a major version, 0.73.0) and source-map-js (1.2.2) is a separate development-dependency change, not part of this review.

Production packages that ship in the shared viewer bundle:

| Package | Version | License | Advisories |
| --- | --- | --- | --- |
| react | 19.2.8 | MIT | None |
| react-dom | 19.2.8 | MIT | None |
| scheduler | 0.27.0 (required by react-dom) | MIT | None |
| lucide-react | 1.31.0 | ISC, with an MIT notice for icons derived from Feather | None |

"None" means npm reported nothing for these versions, and the GitHub advisory database lists advisories for react and react-dom only for versions before 0.14 and 16.4.2. The collector scripts that both packages copy (`scripts/*.mjs`, `*.py` and `*.ps1` without the tests and listed tools, in `native/build.mjs` and `native/windows/WorkspaceObservatory.csproj`) import only Node built-in modules and the Python standard library, with vendored timezone data on Windows. They use no npm package.

The generated notice `Web/assets/third-party-licenses.txt` in the installed build 43 Mac bundle has SHA-256 `726da20b6399284a93bef47d386dcfaa7fabe752697c3e251cfc87e456e168c4`, the same bytes as in the build 43 ZIP. It contains the license text of all four production packages, including the Feather notice, and the SIL Open Font License texts of Inter Tight, Fraunces and JetBrains Mono. The Windows package copies the same generated file to `Licenses\Dashboard-LICENSES.txt`. The build 43 Windows installer was not inspected, because its workflow artifact expired before it was downloaded.

The Windows project locks one NuGet package, Microsoft.Web.WebView2 1.0.4191.47 (`native/windows/packages.lock.json`). The .NET SDK is not installed on the Mac, so `dotnet list native/windows/WorkspaceObservatory.csproj package --vulnerable --include-transitive` was not run. A GitHub advisory database query for that NuGet package returned no advisories. This is weaker than the NuGet query and does not cover the .NET runtime packs. The NuGet query still needs to run on the PC before publication.

Zero production findings is not a vulnerability-free claim. This check does not audit the bundled Node, Python or .NET runtimes (including the pip copy inside the Mac Python runtime, which the app does not run), system webviews, OS components, application logic or future advisories. Repeat it if the lock file changes before publication.

## Dependency review, September 13, 2026 UTC (historical)

This review predates the removal of the earlier web dashboard and its dependencies in October 2026. The October 18 review above covers the current lock file. The source at `34856e3` was checked without installing or updating dependencies. npm reported zero known vulnerabilities across 698 dependencies. NuGet's vulnerable-package query, including transitive dependencies, returned no vulnerable entries for the Windows project. These are advisory-feed results for the resolved dependencies, not a whole-application audit.

See runtime review (archived) for the exact lockfile hashes, commands, installed runtime versions and unresolved Windows Python dependency findings. Final publication remains gated on that review.

### Earlier dependency changes, September 9 (historical)

This section describes a lock file that no longer exists. Vinext, the Cloudflare Vite plugin, Wrangler and the Sharp override were removed with the earlier web dashboard in October 2026. The text below is kept as the dated record.

`npm audit --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org --json` reported zero known vulnerabilities after the reviewed lockfile update. This submits public dependency metadata to npm, not usage records. The earlier seven high entries were addressed with Vinext `1.0.0-beta.6`, Cloudflare Vite plugin `1.47.0`, Wrangler `4.114.0`, their compatible peers, and an explicit Sharp `0.35.4` override. The resolved tree removes image-size and uses ws `8.21.0`.

Relevant advisories: [image-size ICNS loop](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [image-size JXL/HEIF loops](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), [Sharp/libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), and [ws denial of service](https://github.com/advisories/GHSA-96hv-2xvq-fx4p). The Sharp override selects the [maintainer's patched release](https://github.com/lovell/sharp/releases/tag/v0.35.4).

A clean Windows dependency install passed the test suite (121 passed, eight platform skips), TypeScript, the native UI build, and the synthetic production demo build. All four generated native UI files, including license notices, matched the previously verified Mac UI byte for byte. Existing binaries retain their original embedded revisions. This source update does not represent a new binary release.

Zero npm findings is not a vulnerability-free claim. This check does not audit bundled Node, Python or .NET binaries, system webviews, OS components, application logic, or future advisories. Final artifact privacy/integrity and the remaining [release gates](docs/RELEASE-CHECKLIST.md) still require verification. Review updates before deployment or accepting untrusted image/build inputs.

Do not include real usage data, config, credentials or transcripts in an issue. Report reproducible concerns with synthetic examples. Raw records belong to their original tools. Observatory also retains local aggregate history, sanitized cache events, private pairing state and migration archives, not just a replaceable dashboard snapshot. These stores must remain outside Git and release packages. See [private sync](docs/PRIVATE-SYNC.md) for their boundaries.
