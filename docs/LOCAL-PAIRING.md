# Local pairing implementation

## Regression checkpoint

On September 13, source `d18cca8` passed the full Mac JavaScript suite with
433 passes, six platform skips and no failures. The source checkout had no
frontend dependencies, so the run used an existing cached TypeScript 5.9.3
through a test-only module loader. No dependency installation was performed.

The first full Windows run exposed Python fixture imports that depended on
the SSH working directory. Source `9e9ef16` anchors the test helper to its
repository and adds a regression test for unrelated launch directories.
All helper consumers then passed targeted Windows checks. The complete
Windows rerun finished with 407 passes, 33 platform skips and no failures.
These are source regression checks, not installer or live-device sync proof.

## Current boundary

The installed application still uses the existing authenticated SSH transport.
The local-network modules have synthetic client/listener integration tests,
but are not an operational pairing wizard. Importing them does not listen on a
port, contact a device, save credentials or change sharing consent.

The existing SSH setup entrypoints reject TLS transports before creating any
pending pairing or contacting the peer. TLS setup needs its own complementary
configuration and acknowledgement flow. It must not reuse SSH pending setup.
The current native setup status contract is still SSH-only and must be extended
before TLS configurations are enabled in installed apps.

First-release setup targets the same local network or an existing trusted VPN.
Optional Tailscale guidance should open the owning Tailscale client for sign-in
and check connectivity afterward. Observatory must not collect Tailscale
passwords or authentication keys. Network membership does not replace explicit
Observatory device confirmation or data-sharing consent.

## Local confirmation persistence

### Native control process

`scripts/peer-tls-control.mjs --runtime <canonical-runtime>` provides a
newline-delimited JSON channel on parent-child stdin/stdout. Requests contain
an integer `id` and a `command` object. Supported actions are `identity-status`,
`identity-create`, `host-start`,
`host-confirm`, `join-claim`, `join-confirm`, `status` and `cancel`. Invitation
text belongs only in this private pipe or the native setup view, never command
arguments or logs. Replies omit device keys, internal confirmation handles,
pairing configuration and comparison salts. Only host-start returns the
invitation, and status may return the pending peer certificate fingerprint.

The process limits frame buffers, response size and request count, rejects
duplicate IDs, reports generic errors and closes the listener on parent EOF,
termination or a ten-minute session limit. Cancellation interrupts pending
network operations and closes a host that finishes starting after cancellation.
It does not automatically generate identities or grant sharing consent. A native window must
own exactly one child process and close it when setup ends.

Identity creation requires the explicit `restricted-file` storage-consent value.
Mac creation uses the existing system-backed generator inside the child.
Windows generates a P-256 identity in native code and sends it only over the
private input pipe. Both paths reuse a valid saved identity, reject damaged
identity state, and refuse to initialize a missing identity when active pairing
state exists. Cancellation before persistence prevents a new identity write.
The reply reports identity status only, not key material. This is a restricted
plaintext file, not Keychain or DPAPI storage. The UI must disclose that policy
before requesting consent. Native bridge tests on both platforms exercised
consent rejection, creation and reuse in temporary runtimes. Both native Settings
flows now invoke this step only after disclosure and user consent.

`native/TLSSetupProcess.swift` implements the Mac pipe wrapper with bounded
reply parsing, request correlation, a 45-second command timeout and child
shutdown. A temporary native harness verified status, cancellation and child
exit against the real Node controller. Mac Settings now opens a native
`DirectPairingWindowController` for separate Host and Join actions, manual
private-address/port entry, explicit invitation copying, device confirmation
and cancellation. The existing SSH action remains available. Late replies
after cancellation cannot start another operation. Window close stops the
timer and child process. Pairing maintenance remains active until child exit
is verified, with collection paused if exit cannot be verified.

The Ubuntu option on Mac applies to a Windows peer when this Mac hosts setup.
When this Mac joins an invitation, it requests its own Mac-only configuration.
Ubuntu scope is selected on the Windows host. Both the client and join receiver
reject Ubuntu scope for a joining Mac. The Mac view disables its host-only option
while joining and explains this distinction. The fake-bridge regression covers a
join after an earlier Ubuntu host selection without changing the protocol.

The Mac `--test-direct-pairing-model` check uses a fake bridge to test consent,
confirmation, cancellation and cleanup without keys or network access. Full
native compilation and self-tests passed. Visual inspection was blocked by
the locked Mac, so layout and live interactive usability remain unverified.
No installed application was replaced. The saved TLS transport still needs
installed-app and two-device verification before live data sync can be claimed.
`native/windows/TlsSetupProcess.cs` provides the corresponding Windows wrapper.
It uses bounded replies, correlated requests, a 45-second command timeout,
discarded child diagnostics and verified child shutdown. Source `72e88b8`
compiled with zero warnings or errors and passed the native self-tests. The
`--test-tls-setup-bridge` check exercised the real copied Node controller with
status, cancellation, concurrent requests and repeated cleanup in an empty
temporary runtime. Windows Settings now opens `DirectPairingWindow` with Host
and Join actions, private-address entry, identity-storage consent, invitation
copying, device confirmation and cancellation. One collector reservation lasts
until helper cleanup, and unverified helper exit keeps collection paused.
Application quit waits for window cleanup before draining other operations.
The Windows build passed with zero warnings or errors. Native self-tests cover
pairing exclusion, shutdown waiting, repeated release and fail-closed collection.
`--test-direct-pairing-window ABS_NODE` uses a hidden window and temporary runtime
to verify consent rejection, actual helper exit and collector release. It does
not create an identity or connect to another device. Full interactive host/join,
visual layout and cross-device sync verification remain open. Existing installed
SSH setup has not been replaced.

### Pairing commit

`scripts/peer-tls-setup.mjs` provides `commitConfirmedTLSPairing` for a future
local confirmation controller. It validates the proposed pairing and actual
peer certificate against the saved local identity before writing pairing data.
The first configuration write includes the peer certificate fingerprint. If
the process stops before trust is saved, a retry cannot substitute a different
certificate, endpoint or pairing generation. An identical retry verifies the
existing files without rewriting them. Corrupt or conflicting state is not
overwritten and existing revocation checks still apply.

This is a local persistence step, not a network endpoint or a consent prompt.
Its caller must supply the pairing from the pinned setup exchange and the
certificate observed on that connection after local user confirmation. It
returns `local-ready`, not `paired`. Native controller integration and
installed-app activation remain unfinished. It does not start listeners or
enable allowance sharing.

## Invitation format

`scripts/peer-invitation.mjs` creates and validates a versioned, copyable payload
that can later be rendered as a QR code. It contains a numeric private-network
address, an unprivileged port, a SHA-256 certificate fingerprint, a random
256-bit bearer secret and a ten-minute lifetime. Decoding rejects expired,
future-dated, malformed, duplicate-key and noncanonical payloads. Devices need
reasonably synchronized clocks. An expired invitation must be regenerated.

The address policy permits RFC 1918 IPv4, the shared IPv4 range used by
Tailscale, and IPv6 unique-local addresses. It rejects DNS names, public IPs,
loopback, unspecified addresses and IPv6 link-local addresses. This is an
initial address policy, not proof that an address is reachable or trustworthy.
Other existing VPN address schemes are not supported by this primitive yet.

The payload is encoded, not encrypted. Anyone who obtains it obtains the
invitation secret. It must be displayed only during explicit pairing, never
logged or placed in analytics, browser navigation, process arguments or public
URLs. A future copy action must explain that clipboard history can retain it.
It is not a six-digit code. Short human-entered codes require a separately
reviewed password-authenticated exchange.

## In-memory invitation lifecycle

`scripts/peer-invitation-session.mjs` owns one invitation in a single listener
process. The first valid claim consumes the secret synchronously and enters a
pending-confirmation state. Other claims are rejected. Explicit confirmation
returns the pending peer certificate fingerprint once, without writing trust
or granting data access. The transport must supply this fingerprint from the
actual authenticated TLS connection, not a field in the joining request.

Cancellation, replacement and expiry discard both waiting invitations and
pending confirmations. Wall-clock and monotonic deadlines prevent a clock
change from extending the session. Restarting loses all invitation state and
requires a new invitation. Only secret hashes remain in the session object.
Returned invitations and confirmation handles still require private handling.

This state machine is connected to the opt-in listener module, but not a native confirmation UI.
Its single-process guarantee does not coordinate multiple listener processes.
The integration must enforce one listener owner and hold the existing peer
state lock while committing trust. A network disconnect must cancel a pending
claim when setup is interrupted rather than silently restore a consumed secret.
An intentionally completed claim response is not an interrupted setup. Pending
local confirmation may outlive that connection until cancellation or expiry.

## Authenticated claim client

`scripts/peer-tls-client.mjs` checks a supplied certificate against the
invitation fingerprint before dialing. It uses that exact certificate as its
trust anchor, keeps `rejectUnauthorized` enabled, requires TLS 1.3 and the
Observatory pairing application protocol, and checks the connected certificate
again before writing the invitation secret. A local client certificate and key
are required. Responses are bounded to 8 KiB with an eight-second absolute
deadline. Errors contain no remote response or invitation details.

The claim operation does not persist trust or treat an awaiting-confirmation
response as completed pairing. Native identity setup and confirmation remain
unconnected. The
original synthetic mutual-TLS fixture already knows the client certificate.
Additional tests exercise first-pair admission through the listener below.

`claimFromInvitation` removes the need to supply a certificate manually. A
first TLS connection retrieves the server's public certificate without
presenting a client identity or sending application bytes. This bootstrap
connection has no CA trust yet and must match the invitation's exact SHA-256
pin and application protocol before returning the certificate. A second
connection uses that certificate as the explicit trust anchor with normal
verification enabled and sends the claim. Both phases share an eight-second
deadline and support cancellation. A wrong pin stops before the second
connection. This is direct connection to the invitation address, not a
network scan, DNS discovery service or certificate trust-store change.

The implementation follows the certificate and connection APIs in the
[Node.js 22 TLS documentation](https://nodejs.org/docs/latest-v22.x/api/tls.html).

## Opt-in setup listener

`scripts/peer-tls-listener.mjs` binds only when explicitly called, on a selected
private address. It requires a locally supplied identity. First-pair clients
are not yet trusted by a CA, so the server requests a client certificate and
uses TLS proof of key possession, a valid self-signed certificate and the
invitation secret for provisional admission. It accepts RSA keys of at least
2048 bits or P-256/P-384 EC keys. The client still uses strict pinned server
certificate verification. The server's lack of initial CA trust is not a
general certificate bypass and must never be used for normal data exchange.

Only bounded claim, setup-fetch and setup-acknowledgement messages are accepted.
There is no snapshot, quota, file or
command endpoint. Four simultaneous sockets, 64 total connection attempts,
eight-second connection deadlines, a 1 KiB request limit and invitation expiry
bound the setup session. A valid claim exposes its certificate fingerprint and
confirmation handle only through the local module API. Explicit confirmation
through `confirm` returns the fingerprint and closes the listener. It does not
save trust. The separate `confirmSetup` operation keeps the bounded listener
available to the claimed certificate only and publishes the supplied peer
configuration after validating its TLS transport and local server pin. The
local controller must persist its own complementary pairing before calling it.

`requestPeerSetup` fetches this configuration over pinned TLS and verifies the
joining user's expected host and source scope. `receiveConfirmedTLSPairing`
uses the saved local identity, persists and verifies the received pairing and
trust, then sends an acknowledgement digest covering the entire canonical
configuration. A lost acknowledgement returns `local-ready`. An explicit
identical retry can finish without changing the pairing. The listener accepts
repeated matching acknowledgements until cancellation or expiry, but rejects
another certificate or a changed configuration digest. Its acknowledged state
is in memory unless a persistence callback is supplied. The host controller
below supplies that callback. An acknowledgement is not proof of current
remote connectivity, and no UI should label it as such.

`scripts/peer-tls-host.mjs` provides `startHostTLSSetup` for the native controller.
It loads the saved identity, starts an explicit listener and binds its
acknowledgement callback to durable storage. Local confirmation derives the
peer certificate from the pending TLS claim, commits the complementary host
pairing, saves the peer offer, then makes that offer available to the peer.
The peer offer and acknowledgement live in protected `private-sync` files,
so existing revocation and repair boundaries apply. An identical retry reads
the saved generation rather than creating new identifiers. Changed endpoints,
certificates, source scope or corrupt state are rejected without replacement.

`readHostTLSSetup` revalidates the saved offer and acknowledgement against the
active pairing and certificate trust. A fresh-process test verifies that the
receipt survives restart. Reopening the setup listener still requires a new
invitation and local confirmation. Native UI, cross-device endpoint selection
and real two-device restart recovery remain unverified. No installed app starts
this controller yet.

Cancellation closes sockets and invalidates pending confirmation. Native UI,
cross-process listener ownership, secure key storage, discovery and atomic
trust persistence still need integration. Current network tests use ephemeral
loopback listeners and synthetic identities, not the user's paired devices.

## Required integration before enabling pairing

The opt-in record listener in `scripts/peer-tls-sync.mjs` uses strict mutual
TLS against saved peer trust and the separate `observatory-sync/1` protocol.
It rereads generation-bound trust under the peer lock before calling the
existing `exchangePeerRecord` handler. This preserves record validation,
duplicate handling and revocation rather than creating another store. Two
simultaneous sockets, a 17 MB request/response ceiling and a 30-second socket
deadline bound each listener. Errors return no private state.

Native app source now owns the record-listener process. It exposes the existing
record exchange shape and a fixed quota channel with separate sharing consent,
not commands or files. Installed-app verification remains open. Synthetic loopback
tests verify saved-record exchange, rejection of wrong certificates and record
identities, duplicate delivery and revocation. Closing the listener now waits
for in-flight record handlers after closing its sockets.

New confirmed TLS pairings persist `localEndpoint` as well as the remote
`transport`. The complementary offer reverses these endpoints, and the setup
acknowledgement digest covers both. A retry cannot silently change either
endpoint. Existing SSH and older TLS configurations remain unchanged. A TLS
configuration without a local endpoint cannot start the background service.

`scripts/peer-tls-service.mjs` provides that service behind a private parent-child
pipe. Native launch activates a 30-second reconciliation timer without repeated
parent commands, so the bounded command-ID space cannot expire during normal use. It
loads saved pairing and trust, binds only the saved numeric private endpoint,
reuses an unchanged live listener, and closes before replacing a changed one.
It retries a failed listener on a later tick, closes after revocation or failed
validation, and drains a late-starting listener on cancellation. The listener
checks the exact expected pairing under the peer lock before binding and before
accepting a record. No identity or pairing is created by this service.
Parent EOF or termination stops it. Replies contain only service status, not
addresses, certificates or records. `sync-listening` means a local listener is
open, not that the peer is connected or data has synchronized.

`TrustedSyncProcess.swift` and `native/windows/TrustedSyncProcess.cs` each own one
helper. The native collection lifecycle launches it only after first-run consent
and when a saved TLS trust file exists. The helper still validates that file and
the pairing before listening. Preview and unpaired startup do not launch it.
The normal 30-second app tick can restart an exited helper, but never overlaps a
still-running one. Shutdown closes stdin and verifies process exit without a
forced kill. A quit timeout keeps the application open. Output is discarded
without retaining private diagnostics, and Node runtime overrides are
removed from the child's environment.

Both native builds and owner tests passed, including sustained startup, duplicate
prevention, graceful exit, restart and a deliberately slow helper. The Mac uses
`realpath` for its runtime argument, matching the controller's canonical-path
requirement. Mac shutdown regression tests and Windows native self-tests passed.
These tests use temporary runtimes and do not demonstrate installed two-device
sync or successful network recovery on the user's devices.

### Opt-in two-device verification

`scripts/peer-live-fixture.test.mjs --live-peer PRIVATE_IP` is a test-only worker
for a private stdin/stdout controller. It is excluded from both native collector
packages. It creates its own temporary runtime and synthetic identity, supports
host/join confirmation, service start/stop, record publication, exchange and
revocation, plus separately consented synthetic allowance exchange, then removes
its runtime after verified service exit. It never opens
an installed application's runtime. The fixture uses test OpenSSL installations,
not the native production identity generators. Its payloads contain synthetic
source-status records, not the user's activity or provider usage.

The worker protocol can return an invitation to its private parent pipe. Do not
record that output in logs or pass it through shell arguments. A five-minute
fixture deadline closes input and starts cleanup. The test controller must also
await worker exit and treat any cleanup failure as unresolved.

After both services report listening, the private controller can send
`quota-enable` to each fixture. This creates fictional Mac 40% and Windows 70%
readings inside their temporary stores and enables sharing only there.
`quota-exchange` uses the production transport. `quota-status` reports only
sharing state, separate local/peer percentages and the peer sample count.
It does not report account scope, keys, certificates or raw histories.

The live acceptance sequence is to exchange from both devices, repeat delivery
without increasing the peer sample count, restart each service and verify
retained values, then send `quota-disable` to one device and exchange from the
other. The peer projection must clear without deleting local readings. A
disabled sender must return `disabled` without contacting its peer. Repeat with
the opposite device, then revoke pairing and await fixture cleanup. Each step
needs a successful reply before proceeding. Do not infer it passed from the
fixture's existence. `peer-live-quota.test.mjs` verifies the allowance actions
with synthetic in-memory transport, not a live network or service restart.

The September 13 two-device attempt did not establish pairing. Each fixture
listener accepted local TCP connections, while cross-device attempts timed out
before TLS. The Windows test token matched enabled sandbox-managed outbound
firewall block rules. Those rules were not changed or bypassed. Test processes
exited and removed their temporary runtimes. An approved network-enabled test
environment is required before repeating the live check. This result does not
invalidate the local tests, but it is not evidence of working two-device sync.

The outbound path in `peer-tls-outbound.mjs` is now selected by
`finalizePeerCollection` for an explicit TLS transport on either platform.
Saved pairing configuration permits a numeric private address and port, while
existing SSH remains Mac-initiated and cannot accidentally consume a TLS
configuration. The TLS client requires saved trust and an exact match to the
published local record. It rechecks trust and the configured destination before
writing, validates the certificate pin and application protocol, and bounds
the response and connection lifetime. It does not hold a local peer lock over
network waits. Responses still pass through `acceptPeerState` before merging.
Network failure preserves valid local and previously accepted peer data.

This is collector source integration, not installed cross-device sync. The
native source can now start the trusted listener, but installed mutually
acknowledged TLS pairing still needs verification.

### Allowance history over TLS

The same pinned listener dispatches a bounded `quota` channel to `exchangeQuota`.
Both owners must separately enable allowance sharing. A readiness request sends
no readings. The outbound client validates the saved pairing, consent and exact
sanitized payload again after the handshake, before writing application data.
Quota envelopes have a 1.1 MB limit. Account identifiers and local scope hashes
are not included.

Either TLS peer can initiate `syncQuota`. Network waits do not hold the local
pairing lock. After each wait, the collector rechecks the exact pairing and
sharing generation before committing a reply. Concurrent inbound exchanges may
advance storage revisions without revoking consent. Disable followed by
re-enable creates a new generation and cannot resume an older exchange.
Existing SSH synchronization remains Mac-initiated.

Mac synthetic loopback tests cover pinned quota exchange, receiver identity
checks, omitted private scope hashes, unexpected-field rejection, post-handshake
revocation and remote disable. Simulated concurrent exchanges cover both roles
without opening a network connection. These checks do not prove installed
two-device exchange or remove the Windows network verification gate above.

`scripts/peer-tls-trust.mjs` persists a confirmed peer certificate in
`private-sync/tls-trust.json`. The record is bound to the saved pair ID, both
device IDs and the local certificate fingerprint. It requires a saved pairing
with no transport or an explicit TLS transport and refuses overwrites, mismatched fingerprints,
self-pairing, corrupt files, links and changed identities. The existing peer
lock serializes creation and reads. Existing revocation blocks trust reads,
and explicit repair retains the trust file with the retired generation.

The listener's local pending-claim API now includes the certificate obtained
from the TLS connection. A native confirmation handler still needs to bind
that claim to complementary pairing configuration acknowledged by both
devices before calling the trust store. The trust store itself is not a
remote endpoint and does not verify UI intent. It grants no sharing scope,
starts no listener, and is not called by installed collectors. Trust
persistence does not yet replace SSH exchange or complete the setup flow.

The storage primitive in `scripts/peer-device-identity.mjs` validates that a
supplied private key matches its current self-signed certificate. Explicit
initialization writes once into `private-device-identity`, using the existing
cross-process peer lock, exclusive file creation and a flushed write. Reads
reject linked, oversized, changing or malformed files. Existing empty or
damaged identity directories require recovery and are not overwritten.

On macOS the directory and file use owner-only permissions. Windows uses the
existing verified ACL policy for the current user, SYSTEM and Administrators.
This is access-controlled plaintext key storage, not Keychain, DPAPI or
hardware-backed encryption. It cannot protect against code running as the
same user or an administrator. The native setup must not enable it silently
or claim stronger protection. OS-backed key protection remains a release
security decision. No real device identity has been created by these tests.

Identity generation is available in source. The Mac helper creates a P-256 key
in memory and passes it through stdin to `/usr/bin/openssl`, using the fixed
system request configuration and a clean environment. Windows uses .NET
`CertificateRequest` in `native/windows/DeviceIdentity.cs`. Neither generator
writes files, installs a trust root or logs its returned key. Both use a generic
certificate subject and a roughly one-year validity period. Native setup and
expiration/rotation UX remain missing. Storage does not automatically generate
a replacement when its directory is absent. The caller must distinguish
initial setup from loss of an established identity.

The Mac generator passed validation and the real loopback TLS claim flow.
Windows source `b02f20c` compiled with zero warnings or errors and passed native
self-tests, including key/certificate matching and signature verification.
Windows source `587e359` also compiled cleanly and passed
`--test-device-identity-bridge` with the pinned Windows Node runtime. That check
generates two identities in .NET, passes them through stdin to the copied
collector script, validates them in Node, and completes a real loopback TLS
claim and explicit confirmation. It writes no identities to disk. This is
native-to-Node interoperability evidence, not a cross-device setup-wizard test.
The Windows implementation uses the existing shipped .NET runtime, not Git or an
external OpenSSL installation. See Microsoft's
[CertificateRequest API](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.x509certificates.certificaterequest?view=net-10.0).

1. Generate and privately persist a device TLS key and certificate. The
   invitation fingerprint must be computed from that actual certificate.
2. Start a bounded TLS listener only for explicit setup on the selected private
   interface. Verify the pinned certificate before sending any invitation
   secret. Never use an unconditional certificate-validation bypass.
3. Validate expiry on the issuing device and atomically consume the invitation
   once. Cancellation, replacement, timeout and restart must invalidate it.
   The session primitive implements in-process consumption, but the transport
   still needs to wire cancellation and enforce one listener owner.
4. Bind the joining device identity to the authenticated exchange, require
   local device confirmation, then persist mutual trust. A fingerprint merely
   supplied by the remote connection is not a trusted identity.
5. Reuse existing source sanitization, generation fences, locking and explicit
   per-category sharing consent. Tailscale membership alone grants no sharing
   consent. Never overwrite an existing pairing to resolve a conflict.
6. Verify wrong certificates, intercepted invitations, concurrent replay,
   interrupted setup, cancellation, revocation and network changes on both
   platforms before exposing the wizard to users.

No custom cryptographic exchange is implemented here. Certificate pinning uses
the same general identity principle described in
[Syncthing's device identity documentation](https://docs.syncthing.net/v1.23.1/dev/device-ids.html).
A potential short-code protocol needs separate evaluation against
[RFC 9382, SPAKE2](https://www.rfc-editor.org/rfc/rfc9382.html), which is an
informational RFC, not an implemented dependency or a security certification.
