<div align="center">
  <img src="public/favicon.svg" width="80" height="80" alt="Observatory telescope">
  <h1>Observatory</h1>
  <p>Screen time and AI usage across your devices.</p>
  <p>
    <a href="https://scriblesean.github.io/observatory/">Explore the demo</a>
    &nbsp; · &nbsp;
    <a href="docs/GUIDE.md#development">Build from source</a>
    &nbsp; · &nbsp;
    <a href="docs/ROADMAP.md">Roadmap</a>
  </p>
</div>

## What it shows

Observatory shows recorded app activity, Codex tokens, available account limits, tool activity and dictation statistics. A compact Mac menu-bar or Windows system-tray panel opens the full dashboard.

The dashboard opens Allowances for usage limits. Select Activity for screen time, Tokens for compute usage, or Dictation for voice usage. Missing sources do not block the other views.

| View | What it brings into focus |
| --- | --- |
| **Screen time** | Active app time, daily and weekly timelines, and overlap-aware Mac and Windows totals. |
| **AI usage** | Retained Codex tokens by model and day, cached input, and separately reported quota windows where available. |
| **Workflows** | Recorded tool identities, agent receipts and local-model benchmark results, with explicit coverage. |
| **Dictation** | Voice usage by tool and device, with Wispr recording metadata and explicit gaps in coverage. |

Missing data stays missing. Estimates stay labeled. Token counts are not subscription bills, and app activity is not a productivity score.

## Data and privacy

The first release uses [direct device pairing](docs/PAIRING-MAINTENANCE.md), without an Observatory account or hosted sync service. The current pairing flow requires an existing verified SSH connection. It shares supported sanitized records, not provider credentials, prompts, window titles, transcripts or recordings. Optional allowance-history exchange is tested with fictional records. Real-device allowance sharing remains unverified and is off on the development pair.

Saved history can be displayed again after a UI repair, but observations that were never recorded cannot be reconstructed. Recent allowance graphs use a bounded snapshot. Development builds include an owner-local saved-history browser with usage-% charts and no automatic archive expiry. Public installers are not yet available. See [history coverage and recovery](docs/USAGE-LIMITS.md).

## Try it

**[Open the interactive demo](https://scriblesean.github.io/observatory/)** to explore fictional records without connecting any accounts or devices.

The project is an early preview tested on one Mac, Windows and WSL setup. Build 28 remains installed on the development machines; build 29 artifacts are staged for a recorded development upgrade. **Public installers are being prepared, not yet available.** See the [current verification and candidate limitations](docs/RELEASE-0.3.13.md).

| Platform | Current status |
| --- | --- |
| macOS, Apple Silicon | [Build the native app from source](docs/MAC.md). Development candidates bundle Node and Python. No public installer yet. |
| Windows x64 | [Build the native app from source](docs/WINDOWS.md). Installer candidates have been tested on the development machine. No public installer yet. |
| Ubuntu / WSL | Configured token and workflow sources. Standalone desktop app planned. |

For now, choose the hosted demo or build from source using the platform guides above. Building requires developer tools. The download-and-install path is not available yet.

Fresh desktop setups ask which sources to enable before collecting. ActivityWatch must be installed separately for screen time. Provider account management, unified allowance history and clean-machine release verification are still in progress. Read the [setup guide](docs/GUIDE.md) and [integration coverage](docs/SOURCE-COVERAGE.md) before connecting records.

Automatic app updates are not available yet. Changes pushed to this repository do not update an installed app. See [desktop updates](docs/UPDATES.md) for the signing, installation and recovery work required before enabling them.

## Go deeper

[Product direction](docs/PRODUCT-DIRECTION.md) · [Usage limits](docs/USAGE-LIMITS.md) · [Tracking reuse](docs/TRACKING-REUSE.md) · [Private sync](docs/PRIVATE-SYNC.md) · [Security](SECURITY.md) · [Roadmap](docs/ROADMAP.md)

Contributions are welcome, especially reproducible bugs, tested adapters and accessibility improvements. Use synthetic examples. Never attach private usage records or account details.

[MIT license](LICENSE) · [Third-party acknowledgments](THIRD-PARTY-NOTICES.md)
