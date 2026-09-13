# Private pairing maintenance

Pairing setup has a CLI and a Mac setup dialog. Both native apps can prepare their own installation for repair, followed by authenticated setup from the Mac. This is an explicit two-device operation, not automatic recovery. Do not hand-edit identifiers, remove a revocation marker to reconnect, or reset a sequence counter. No permanent pairing is installed by the release build process.

## Set up or resume a pairing

Use the Mac setup CLI only after verifying that the SSH alias resolves to the intended Windows machine and account, its host key is trusted, and noninteractive key authentication already works. This tool does not create credentials, enable SSH, accept a new host key or open a network listener. Both installations need the updated collector scripts, including `peer-setup-endpoint.mjs` on Windows.

In the Mac source build, choose **Pair with Windows…** from the app menu or menu-bar icon's context menu. Enter the existing SSH alias, Windows bundled Node executable, exchange script and app data directory. Ubuntu scope is optional and does not start or enable a source. Cancel sends nothing. Setup blocks this app's collection while the dialog or request is active. On success, local collection resumes. If the request fails, collection stays paused for that app session and the saved target can be retried. This session pause does not stop a different process or device.

The Windows source build provides **Pairing details for Mac…** in its tray menu. It derives the three paths from the running installation, checks that the bundled setup tools are present and offers **Copy Windows details**. Copy is an explicit action. The text contains installation paths that can identify your Windows username, but no keys, pairing identifiers or usage records. Transfer it to the Mac using a method you trust. Observatory does not synchronize clipboards.

On Mac, **Paste Windows details** reads the clipboard only when selected. It validates the format and all three paths before filling the form. It cannot change the SSH alias or Ubuntu scope and does not send setup. Review the fields and confirm **Pair devices** separately. Invalid content leaves the fields unchanged. Paste is disabled for an already saved target.

Saved pending and active targets are prefilled and read-only. The form does not receive comparison salts, device identifiers or records. Revoked, corrupt or conflicting local state shows a repair message instead of a replacement form. The read-only CLI `--status` mode supplies these fields without creating pairing state. It is not a remote health check.

The September 9 Mac preview check covered form layout, rejection of empty fields, cancellation without a pairing write, acknowledged setup over the existing SSH route, saved-target verification without changing the generation and an unavailable-peer error. The two pairings were temporary and removed afterward. The later details-import form was inspected without accessing the owner's clipboard. Windows copy and Mac paste handlers have synthetic clipboard tests. Windows dialog visual review and real clipboard transfer remain unverified. This is not a clean-machine authentication/setup check. Subsequent repair support is described below.

The command reads an explicit request from stdin:

```sh
node scripts/peer-setup.mjs --runtime /absolute/path/to/private/runtime --setup < /absolute/path/to/setup-request.json
```

Example request with fictional paths, to be replaced with the verified installation paths:

```json
{
  "includeUbuntu": false,
  "transport": {
    "kind": "ssh-windows",
    "hostAlias": "my-windows",
    "remoteNode": "C:/Apps/Observatory/Runtime/node.exe",
    "remoteScript": "C:/Apps/Observatory/Collector/scripts/peer-exchange.mjs",
    "remoteRuntime": "C:/Users/Example/AppData/Local/Workspace Observatory"
  }
}
```

Keep the request outside Git because it identifies private installation paths. It contains no SSH key or comparison salt. `includeUbuntu` is explicit pairing scope, not permission to enable or reconfigure WSL collection. The corresponding source must be configured consistently on Windows before it can export usable data.

The Mac first saves `private-sync/setup.pending.json`. Normal collection ignores this pending configuration and stays standalone. Setup sends the complementary Windows configuration only through authenticated SSH stdin. The Windows endpoint either initializes an empty private directory or verifies an exact match with an existing pairing. It refuses a different generation, revoked state or unreadable configuration. After a successful acknowledgement, Mac exclusively creates its active configuration and removes the pending file.

If the connection fails or its reply is lost, retry the same command with the same target and Ubuntu scope. The saved pending generation is reused. A remote pairing may already exist after an uncertain reply; retries do not reset it. Active matching pairings can also be rechecked without changing their credentials. A changed target or scope requires explicit repair, not an automatic replacement.

Partial or corrupt files fail closed. A process interrupted during a file write can leave state that needs repair; this is not a fully crash-atomic transaction across two computers. Setup does not erase those files or revoke a remote pairing as rollback. Revocation during setup prevents subsequent local activation, but an acknowledged remote write can remain and must be handled on that device.

## Disable a local pairing

The native Mac and Windows menus now include **Disconnect paired device…** in source. The confirmation defaults to Cancel or No and explains that the operation affects this installation only. It refuses to start during local collection. If the bundled tool fails, collection is paused for that app session so an automatic refresh does not immediately attempt another exchange. Retry disconnection or quit until the state can be inspected. This pause is not a persistent setting and does not stop another process or device.

These controls have native build and temporary-runtime integration coverage. On Mac, the unpaired-state message, confirmation layout, cancellation without revocation, confirmed revocation and subsequent local collection were verified in an isolated all-sources-disabled preview. Windows interactive confirmation/cancellation and both platforms' failure/retry presentation still need desktop verification. For the current installed build and package boundaries, see the [release evidence](RELEASE-0.3.8.md).

The source CLI supports an explicit local disable operation:

```sh
node scripts/peer-revocation.mjs --runtime /absolute/path/to/private/runtime --revoke
```

Use the runtime of the installation you intend to disable, not the source checkout. On Windows, use an absolute Windows path and quote paths containing spaces. The runtime directory must already exist and pass the private-directory checks. The command reports only a generic status, never comparison salts, device identifiers or snapshots.

For a controlled cutoff, quit both native apps and stop their collector jobs or test processes before running the command separately on each device. An already started exchange may complete; local revocation cannot recall data already sent. This command does not change SSH keys, host access, startup settings or the other device.

The operation creates `private-sync/revoked` without overwriting existing files. Even an empty interrupted marker disables pairing. Repeating the operation is safe for a normal existing marker. Unsafe permissions or linked entries fail closed. The configuration and database remain on disk for explicit recovery. This is not data erasure.

Subsequent collection runs locally without exporting or merging the peer snapshot. An already displayed combined dashboard can remain visible until the next successful collection replaces it. Revocation does not rewrite that display immediately.

## Repair or rotate

Use repair only when you intend to replace the existing pairing. Temporary network loss does not by itself require retirement. First restore the existing authenticated connection and retry the saved target.

1. On Windows, choose **Prepare pairing repair…** and review the local confirmation. This disables existing pairing state and retains it in a private backup. It does not contact the Mac or create a new pairing.
2. On Mac, choose **Prepare pairing repair…** and confirm separately. Both devices must consent. Preparing only one device cannot replace the other device's generation.
3. From the Mac, choose **Pair with Windows…**, verify the intended SSH target and Windows installation paths, then confirm setup. The existing authenticated SSH route must still work.
4. Check that setup succeeds and subsequent source observations are fresh on both devices. A prepared-repair message alone does not mean the devices are connected.

The new pairing uses fresh comparison credentials and sequence state. Retired state remains disabled in a `private-sync-retired-*` directory. Do not copy it over the new generation or delete it as a repair shortcut. Retirement does not revoke SSH credentials, erase saved dashboard history or recall an in-flight transfer.

If an acknowledgement is lost, retry the same saved setup request. The pending generation is reused. If preparation fails, stop and inspect that installation before changing files: state may already have been retired. Native collection is paused for that session on failure. Repeated blind repair attempts are not a recovery strategy.

Synthetic protocol tests cover both preparation orders, refusal without both confirmations, fresh credentials, rejection of old-generation writes, lost-reply retry, retained corrupt state and linked-path refusal. These do not establish the complete interactive two-device repair flow, actual network-loss recovery or power-loss durability on the installed apps.

## Verification limits

Synthetic tests cover local revocation, unchanged stored bytes, refusal to initialize over revoked state, malformed configuration, interrupted markers, stale in-memory pairing, exchange refusal and standalone native collection. They do not prove immediate cancellation of an in-flight transfer, remote SSH-access revocation, power-loss durability or complete two-device onboarding. Source, packaged and installed evidence must remain distinct.
