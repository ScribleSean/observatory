<div align="center">
  <img src="public/favicon.svg" width="80" height="80" alt="Observatory telescope">
  <h1>Observatory</h1>
  <p>A Mac menu-bar and Windows tray app that shows your Claude Code and Codex limits, your token usage and your screen time.</p>
  <p>
    <a href="docs/GUIDE.md">Guide</a>
    &nbsp; · &nbsp;
    <a href="docs/GUIDE.md#development">Build from source</a>
    &nbsp; · &nbsp;
    <a href="docs/DESIGN.md">Design direction</a>
    &nbsp; · &nbsp;
    <a href="docs/ROADMAP.md">Roadmap</a>
  </p>
</div>

<p align="center">
  <img src="docs/images/panel-spike-dark.jpg" width="320" alt="The Observatory panel in dark appearance, showing limits for Claude Code and Codex, device and period filters, token totals and screen time, with sample data">
  <img src="docs/images/panel-spike-light.jpg" width="320" alt="The same panel in light appearance with sample data">
</p>

<p align="center">The panel that is being built, shown with sample data. See <a href="#status">Status</a> for what the current build shows.</p>

## What it does

- Shows how much of each coding limit is left, when it resets and how fast it is being used.
- Shows recorded tokens by day and model. For Codex it adds an estimate of what the same tokens would cost at public API prices.
- Shows screen time by app category, from [ActivityWatch](https://activitywatch.net/).
- Filters by device and by period.
- Optionally pairs a Mac and a Windows PC, and shows a combined total only when it can confirm no session is counted twice.

Observatory runs on your computer. It has no account and no hosted service. It reads records that other tools already keep, and it makes no model requests.

## Status

Observatory is under active development. The current build is 0.3.14 build 41.

| Area | Current build | In progress |
| --- | --- | --- |
| Codex limits, pace and history | Yes | |
| Codex tokens by day and model | Yes | |
| Screen time from ActivityWatch | Yes | |
| Claude Code tokens | Collected, shown only under Source health | Shown beside Codex |
| Claude Code limits | Collected, with consent. Not shown on a screen yet. | Shown beside Codex |
| Periods | Day, Week, All retained | Now, Day, Week, Month, All time |
| Pairing two devices | Over an existing SSH connection | Tailscale with a pairing code |
| Interface | Separate SwiftUI and Windows Forms interfaces | One shared interface for both platforms, with skins |
| Dictation statistics from Wispr Flow | Yes, optional | |

[The design direction](docs/DESIGN.md) describes where the app is going. [The parity table](docs/PARITY.md) lists what each platform has. [The state record](docs/STATE.md) lists what has been verified on which build.

## Requirements

| | Mac | Windows |
| --- | --- | --- |
| System | macOS 14 or later, Apple Silicon | Windows x64 |
| For screen time | [ActivityWatch](https://activitywatch.net/), installed and running | The same |
| For Codex data | Codex installed and signed in | The same |
| For Claude Code data | Claude Code installed | The same |

Each source is optional. A source that is off or unavailable shows Unknown and does not block the others.

## Install

There is no installer download yet. Build the app from source with the guide for your platform.

| Platform | Guide |
| --- | --- |
| macOS, Apple Silicon | [Mac app and menu bar](docs/MAC.md) |
| Windows x64 | [Windows app and tray](docs/WINDOWS.md) |

Builds are unsigned, so macOS and Windows show a security warning for them. Automatic app updates are not available. Changes pushed to this repository do not update an installed app. See [desktop updates](docs/UPDATES.md).

On first launch the app asks which sources to read. Nothing is collected before you finish that step. See the [guide](docs/GUIDE.md) and [source coverage](docs/SOURCE-COVERAGE.md).

## Data and privacy

- Records stay on your devices. The app stores daily totals and limit readings, not prompts, window titles, transcripts, commands or recordings.
- Provider sign-ins stay in their own apps. Observatory does not read, copy or store credentials.
- Reading limits asks the provider's own installed client for the account's current limits. Collection makes no other request to a provider.
- [Pairing](docs/PAIRING-MAINTENANCE.md) is optional and sends sanitized records directly between your two devices. Sharing limit history or Claude Code usage needs separate consent on both.

See [private sync](docs/PRIVATE-SYNC.md) and [security](SECURITY.md).

## How to read the numbers

- Unknown means a value was not read. It never means zero.
- A limit percentage comes from the provider. A dollar figure is an estimate at public API prices and is not a bill.
- Token counts include cached input. They do not tell you how much of a subscription is left.
- Screen time is foreground app time. It does not measure attention or output.
- Records from two devices are never added together unless the overlap check passes.

## Scope

WSL and Ubuntu tracking are out of scope, as is a standalone Linux app. iPhone integration is later work and is not implemented. The [interactive demo](https://scriblesean.github.io/observatory/) is built from the shared viewer with fictional sample data. The copy published today still shows the earlier web interface. It is replaced when the next release is published.

## Contributing

Bug reports with steps to reproduce and small fixes are welcome. Use synthetic examples, and never attach real usage records or account details. Read [AGENTS.md](AGENTS.md) for the project's boundaries before opening a pull request.

[MIT license](LICENSE) · [Third-party acknowledgments](THIRD-PARTY-NOTICES.md)
