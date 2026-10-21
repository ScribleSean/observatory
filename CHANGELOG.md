# Changelog

## 2.0.0, the lean hub (unreleased)

Observatory was rebuilt from a full desktop app into a small menu bar companion with a local dashboard. The old app is kept on the `archive/full-app` tag.

### Added

- **Agents.** See which Claude Code sessions are working, waiting on you, idle or done, and recent codex-job runs, per computer. Only status, project and session names and times are read. Transcripts, prompts, key files and job output are never opened.
- **Four answers at a glance.** The dashboard opens on tiles for limits, agents, screen time and cost, then pages for Limits, Agents, Activity, Tokens and Sources.
- **Zero-config install.** `git clone`, then `npm run setup`. Setup writes a settings file with every source on, builds the dashboard and the menu bar or tray app on your own computer, and starts it at login. `npm run setup -- --remove` takes it out again.
- **Optional second computer.** A Mac and a Windows PC can share one view over your own SSH connection. Limits are never added across computers, and sums of time, tokens and cost are labeled "not deduplicated".
- **Your own time zone.** Days are counted in each computer's time zone instead of a fixed one.

### Changed

- The readers that were written in Python are now in Node, checked against saved results from the Python versions. Node is the only runtime to install.
- One hand-edited `observatory.config.json` replaces the settings screens. A source runs only while it is `true` there.
- The dashboard is read-only and listens on 127.0.0.1 only.

### Removed

- Device pairing with invitations and its TLS service, consent and sharing sync, the settings and setup screens, signed packages, installers and updates, dictation, three of the four skins, and the demo page. Everything removed is on the `archive/full-app` tag.

### Before you update from build 43 or 42

Quit the old app and turn off its login item. The new collector uses the same data folder, and on its first run it keeps a copy of the old snapshot as `usage.before-hub.json`.
