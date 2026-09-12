<div align="center">
  <img src="public/favicon.svg" width="80" height="80" alt="Workspace Observatory telescope">
  <h1>Workspace Observatory</h1>
  <p>Screen time and AI usage across your devices.</p>
  <p>
    <a href="https://scriblesean.github.io/workspace-observatory/">Explore the demo</a>
    &nbsp; · &nbsp;
    <a href="docs/GUIDE.md">Get started</a>
    &nbsp; · &nbsp;
    <a href="docs/ROADMAP.md">Roadmap</a>
  </p>
</div>

## What it shows

Observatory shows recorded app activity, Codex tokens, available account limits, tool activity and dictation statistics. A compact Mac menu-bar or Windows system-tray panel opens the full dashboard.

| View | What it brings into focus |
| --- | --- |
| **Screen time** | Active app time, daily and weekly timelines, and overlap-aware Mac and Windows totals. |
| **AI usage** | Codex tokens by model and day, cached input, and separately reported quota windows where available. |
| **Workflows** | Recorded tool identities, agent receipts and local-model benchmark results, with explicit coverage. |
| **Dictation** | Wispr Flow audio duration and word counts. Retained TypeWhisper statistics stay separate. |

Missing data stays missing. Estimates stay labeled. Token counts are not subscription bills, and app activity is not a productivity score.

## Data and privacy

The first release uses [direct device pairing](docs/PAIRING-MAINTENANCE.md), without an Observatory account or hosted sync service. The current pairing flow requires an existing verified SSH connection. It shares supported sanitized records, not provider credentials, prompts, window titles, transcripts or recordings. Account-limit history is not synchronized yet.

Saved history can be displayed again after a UI repair, but observations that were never recorded cannot be reconstructed. Allowance history has [bounded retention](docs/USAGE-LIMITS.md).

## Try it

**[Open the interactive demo](https://scriblesean.github.io/workspace-observatory/)** to explore fictional records without connecting any accounts or devices.

The project is an early preview tested on one Mac, Windows and WSL setup. The Mac app currently builds from source. **Public installers are being prepared, not yet available.**

| Platform | Current status |
| --- | --- |
| macOS, Apple Silicon | [Native SwiftUI main window and menu-bar panel](docs/MAC.md), with bundled Node and Python. Public release pending. |
| Windows x64 | [Native main window and system-tray panel](docs/WINDOWS.md). Installer tested and installed on the development machine. Public release pending. |
| Ubuntu / WSL | Configured token and workflow sources. Standalone desktop app planned. |

Fresh desktop setups ask which sources to enable before collecting. ActivityWatch must be installed separately for screen time. Provider account management, unified allowance history and clean-machine release verification are still in progress. Read the [setup guide](docs/GUIDE.md) and [integration coverage](docs/SOURCE-COVERAGE.md) before connecting records.

## Go deeper

[Product direction](docs/PRODUCT-DIRECTION.md) · [Usage limits](docs/USAGE-LIMITS.md) · [Tracking reuse](docs/TRACKING-REUSE.md) · [Private sync](docs/PRIVATE-SYNC.md) · [Security](SECURITY.md) · [Roadmap](docs/ROADMAP.md)

Contributions are welcome, especially reproducible bugs, tested adapters and accessibility improvements. Use synthetic examples. Never attach private usage records or account details.

[MIT license](LICENSE) · [Third-party acknowledgments](THIRD-PARTY-NOTICES.md)
