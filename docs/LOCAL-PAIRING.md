# Local pairing implementation

## Current boundary

The installed application still uses the existing authenticated SSH transport.
The local-network invitation module is an unconnected building block, not an
operational pairing wizard. Importing it does not listen on a port, contact a
device, save credentials or change sharing consent.

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

## Required integration before enabling pairing

1. Generate and privately persist a device TLS key and certificate. The
   invitation fingerprint must be computed from that actual certificate.
2. Start a bounded TLS listener only for explicit setup on the selected private
   interface. Verify the pinned certificate before sending any invitation
   secret. Never use an unconditional certificate-validation bypass.
3. Validate expiry on the issuing device and atomically consume the invitation
   once. Cancellation, replacement, timeout and restart must invalidate it.
   The codec itself does not implement replay prevention or authentication.
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
