# Observatory 2.0: the lean hub (draft release notes)

Draft for the GitHub release. Nothing is published. Title: **Observatory 2.0, a calm menu bar companion for AI coding agents**.

---

Observatory sits in your Mac menu bar or Windows tray and answers three questions at a glance:

- **Am I near my limits?** Claude Code and Codex, each window, with percent left and reset time.
- **Where did my time go?** Screen time by app and category, from ActivityWatch.
- **What did it cost?** Tokens and their API-equivalent cost.

It only watches. It never starts, stops or answers an agent, and Observatory itself sends nothing anywhere. To read your limits it asks the Claude Code and Codex apps you already have.

![The dashboard on one computer](docs/images/dashboard-one-computer-light.png)

(Before publishing, upload this image to the release so it renders there.)

## Install

You need Node.js 22.13 or later. On a Mac, also the Xcode Command Line Tools. For screen time, ActivityWatch.

```bash
git clone https://github.com/ScribleSean/observatory.git
cd observatory
npm run setup
```

Setup builds everything on your computer and starts the app at login. There is no installer to download and no account.

## What's new since build 44

This is a rebuild, not an update. The full desktop app was replaced by a small menu bar app, a read-only local dashboard and one settings file. See the [changelog](CHANGELOG.md) for the full list. The highlights:

- One-command setup with no configuration needed.
- An optional second computer over your own SSH connection.
- Days counted in your own time zone.

## Privacy

Observatory reads records your tools already keep on your computer and stores only totals, limit readings and times. It never stores prompts, messages, session names, window titles or credentials. The tests plant private text and fake keys in sample files and check that none of it reaches saved data. See [Privacy](README.md#privacy).

## Known limits

- One Mac and one Windows PC at most.
- The Windows tray app is compiled on your PC by setup. It has had less use than the Mac app.

## Upgrading from build 43 or 42

Quit the old app and turn off its login item before running setup. Your history is kept, and the old snapshot is saved as `usage.before-hub.json`.
