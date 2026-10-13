# Startup

## Native desktop apps

The native Mac app uses its **Launch at login** control and macOS login-item registration. Its collector runs inside the app, so it does not need the legacy dashboard server or a separate collector LaunchAgent. Do not enable two collection schedulers for the same runtime.

The Windows tray preview has an opt-in **Register start at login** control. See [Windows development and startup](WINDOWS.md) for prerequisites, limitations and remaining verification.

## Legacy macOS web dashboard

The login jobs for the earlier web-server workflow were removed on 2026-10-13. Their instructions are kept at the tag described in [the archive note](ARCHIVE.md).

## Optional automatic collection

Pass `python` as an absolute Python 3 executable path and `collectionIntervalSeconds: 300` to `loginJobs` to generate a third job, `io.ai-usage-dashboard.collector`. It runs on login and at five-minute intervals. Install and bootstrap its property list in the same way. It uses `StartInterval`, not a KeepAlive retry loop. Do not enable a second scheduler for the same collector.

The job runs `scripts/run-collector.py`, which also backs `npm run collect`. An operating-system file lock prevents manual and scheduled runs from overlapping. A busy attempt exits without replacing the active run's status. The lock releases when its process exits, including after a crash. The lock file may remain on disk and does not need to be removed.

Each run is limited to four minutes. A timed-out run stops only its own child process group. Source readers retain their shorter timeouts. The runner discards command output and publishes only status, timestamps and source counts in `public/local/collector.json`. It never starts model tasks. A failed attempt before snapshot publication leaves the previous snapshot intact.

The page checks the saved snapshot and status every 30 seconds while visible. It does not collect through the web server. A snapshot older than ten minutes is marked stale. Each source shows its last check time, which is different from the time of its latest activity or model call.

The hosting Mac must be awake and logged in. After a reboot, login is required. This is not an always-on hosted service. The Windows SSH server and private network connection must also be available. Browser theme preferences remain separate on each device.

Inspect jobs with `launchctl list io.ai-usage-dashboard.server`, `launchctl list io.ai-usage-dashboard.tunnel`, or `launchctl list io.ai-usage-dashboard.collector`. To disable one job, run `launchctl bootout gui/$(id -u)/LABEL`. Move its exact property-list file out of `~/Library/LaunchAgents/` to prevent it loading at the next login. Do not remove unrelated startup jobs.

If the repository moves or the Node installation changes, regenerate the affected property list and reload that job. A port already occupied by another process is an error, not permission to stop an unrelated application.
