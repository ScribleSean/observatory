<div align="center">
  <img src="public/favicon.svg" width="80" height="80" alt="Observatory telescope">
  <h1>Observatory</h1>
  <p>Sean's local screen-time and AI-usage app for Windows and Mac.</p>
  <p>
    <a href="docs/PRODUCT-DIRECTION.md">Personal app scope</a>
    &nbsp; · &nbsp;
    <a href="docs/GUIDE.md#development">Build from source</a>
    &nbsp; · &nbsp;
    <a href="docs/ROADMAP.md">Roadmap</a>
  </p>
</div>

## What it shows

Observatory shows recorded app activity, Codex tokens, optional Claude Code counters, available account limits, tool activity and dictation statistics. A compact Mac menu-bar or Windows system-tray panel opens the full dashboard.

The dashboard opens Allowances for usage limits. Select Activity for screen time, Tokens for compute usage, or Dictation for voice usage. Missing sources do not block the other views.

| View | What it brings into focus |
| --- | --- |
| **Allowances** | Available account limits and recorded usage windows, with gaps kept visible. |
| **Activity** | Recorded foreground app time, daily and weekly history, and overlap-checked device totals. |
| **Tokens** | Retained Codex tokens by model and day, including cached input. |
| **Dictation** | Voice usage by tool and device, with Wispr recording metadata and explicit coverage gaps. |
| **Agents** | Recorded tool identities, agent receipts and local-model benchmark results. |
| **Source health** | Configured-source coverage and separately reported provider readings, including optional Claude Code counters. |
| **Settings** | Source choices, device connections and separate sharing consent controls. |

Missing data stays missing. Estimates stay labeled. Token counts are not subscription bills, and app activity is not a productivity score.

## Data and privacy

Optional [device pairing](docs/PAIRING-MAINTENANCE.md) reuses an existing verified SSH connection, without an Observatory account or hosted sync service. It shares supported sanitized records, not provider credentials, prompts, window titles, transcripts or recordings. Codex allowance-history and per-device Claude usage sharing require separate consent. Historical synthetic checks do not establish that either is enabled or verified on the installed pair.

Saved history can be displayed again after a UI repair, but observations that were never recorded cannot be reconstructed. Recent allowance graphs use a bounded snapshot. Development builds include an owner-local saved-history browser with usage-% charts and no automatic archive expiry. See [history coverage and recovery](docs/USAGE-LIMITS.md).

## Native development and daily use

Use the native apps for collection and daily viewing. Source builds require developer tools. The platform guides retain revision-specific package and installation evidence, not a claim that the latest source is installed or newly verified.

| Platform | Development guide |
| --- | --- |
| Windows x64 | [Windows app and tray](docs/WINDOWS.md), including local builds and guarded package replacement. |
| macOS, Apple Silicon | [Mac app and menu bar](docs/MAC.md), including bundled runtimes and preview checks. |

WSL and Ubuntu tracking are out of scope, as is a standalone Linux app. Older builds and dated evidence may still include those sources. This scope decision does not claim their code has been removed or authorize changing a WSL installation or its records.

Fresh desktop setups ask which sources to enable before collecting. ActivityWatch must be installed separately for screen time. Read the [setup guide](docs/GUIDE.md) and [source coverage](docs/SOURCE-COVERAGE.md) before connecting records. Fixing the remaining native UI issues and making local collection reliable come before adding providers or new setup flows. The [roadmap](docs/ROADMAP.md) lists the acceptance work.

Changes pushed to this repository do not update an installed app. Automatic app updates are not available. Public installers and consumer onboarding are not current goals. Package integrity, privacy checks and recoverable updates still matter for personal use. See [desktop updates](docs/UPDATES.md) and the [dated release evidence](docs/RELEASE-0.3.13.md).

## Development fixture and later integrations

The [interactive demo](https://scriblesean.github.io/observatory/) uses fictional records. It remains a UI development fixture, not the product focus or a place to upload personal data.

iPhone integration and integration with Hermes `/usage` commands are later work. iPhone support depends on supported OS permissions and data access. Hermes integration should reuse supported commands or adapters, not require a Hermes core fork. Neither is implemented by this scope change.

## Go deeper

[Product direction](docs/PRODUCT-DIRECTION.md) · [Usage limits](docs/USAGE-LIMITS.md) · [Tracking reuse](docs/TRACKING-REUSE.md) · [Private sync](docs/PRIVATE-SYNC.md) · [Security](SECURITY.md) · [Roadmap](docs/ROADMAP.md)

Reproducible bugs and small fixes to Sean's native workflow are useful. Use synthetic examples. Never attach private usage records or account details. This scope change does not authorize a release or publication of local data.

[MIT license](LICENSE) · [Third-party acknowledgments](THIRD-PARTY-NOTICES.md)
