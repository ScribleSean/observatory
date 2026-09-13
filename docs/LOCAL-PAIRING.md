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

The client only requests a claim. It does not persist trust or treat an
awaiting-confirmation response as completed pairing. Certificate discovery,
private identity setup and native confirmation remain unconnected. The
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

Only a bounded claim message is accepted. There is no snapshot, quota, file or
command endpoint. Four simultaneous sockets, 64 total connection attempts,
eight-second connection deadlines, a 1 KiB request limit and invitation expiry
bound the setup session. A valid claim exposes its certificate fingerprint and
confirmation handle only through the local module API. Explicit confirmation
returns the fingerprint and closes the listener. It does not save trust.

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

The record listener is not started by the app yet. It exposes only the existing
record exchange shape, not commands, files or the separate allowance-sharing
endpoint. The collector's outbound path remains SSH. Native lifecycle,
outbound TLS transport and both-device setup acknowledgement still need
integration. Synthetic loopback tests verify saved-record exchange, rejection
of wrong certificates and record identities, duplicate delivery and revocation.

`scripts/peer-tls-trust.mjs` persists a confirmed peer certificate in
`private-sync/tls-trust.json`. The record is bound to the saved pair ID, both
device IDs and the local certificate fingerprint. It requires a saved pairing
without a local SSH transport and refuses overwrites, mismatched fingerprints,
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
