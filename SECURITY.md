# Security and privacy

This is an early local-first desktop application with an optional static browser view. Do not expose the browser server to a network or host builds containing personal data. No browser-server authentication or multi-user authorization is implemented; local processes with filesystem access remain in the trust boundary. Cross-device transport is not yet a verified release feature.

Use `npm run serve:local`, not a Vite, Vinext or Wrangler development server for ongoing viewing. It serves static assets through Node built-ins, with no framework server functions or image upload/processing paths. The server accepts only loopback requests with an allowlisted Host, rejects cross-site requests, and does not execute commands.

The native applications load bundled static UI assets in system WebKit or WebView2, not a Vinext or Cloudflare development server. Native bridges and collectors still have their own permissions and input-validation boundaries.

## Dependency review, September 13, 2026 UTC

The current source at `34856e3` was checked without installing or updating dependencies. npm reported zero known vulnerabilities across 698 dependencies. NuGet's vulnerable-package query, including transitive dependencies, returned no vulnerable entries for the Windows project. These are advisory-feed results for the resolved dependencies, not a whole-application audit.

See [runtime review](docs/RUNTIME-REVIEW.md) for the exact lockfile hashes, commands, installed runtime versions and unresolved Windows Python dependency findings. Final publication remains gated on that review.

### Earlier dependency changes, September 9

`npm audit --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org --json` reported zero known vulnerabilities after the reviewed lockfile update. This submits public dependency metadata to npm, not usage records. The earlier seven high entries were addressed with Vinext `1.0.0-beta.6`, Cloudflare Vite plugin `1.47.0`, Wrangler `4.114.0`, their compatible peers, and an explicit Sharp `0.35.4` override. The resolved tree removes image-size and uses ws `8.21.0`.

Relevant advisories: [image-size ICNS loop](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [image-size JXL/HEIF loops](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), [Sharp/libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), and [ws denial of service](https://github.com/advisories/GHSA-96hv-2xvq-fx4p). The Sharp override selects the [maintainer's patched release](https://github.com/lovell/sharp/releases/tag/v0.35.4).

A clean Windows dependency install passed the test suite (121 passed, eight platform skips), TypeScript, the native UI build, and the synthetic production demo build. All four generated native UI files, including license notices, matched the previously verified Mac UI byte for byte. Existing binaries retain their original embedded revisions; this source update does not represent a new binary release.

Zero npm findings is not a vulnerability-free claim. This check does not audit bundled Node, Python or .NET binaries, system webviews, OS components, application logic, or future advisories. Final artifact privacy/integrity and the remaining [release gates](docs/RELEASE-CHECKLIST.md) still require verification. Review updates before deployment or accepting untrusted image/build inputs.

Do not include real usage data, config, credentials or transcripts in an issue. Report reproducible concerns with synthetic examples. Raw records belong to their original tools. Observatory also retains local aggregate history, sanitized cache events, private pairing state and migration archives, not just a replaceable dashboard snapshot. These stores must remain outside Git and release packages. See [private sync](docs/PRIVATE-SYNC.md) for their boundaries.
