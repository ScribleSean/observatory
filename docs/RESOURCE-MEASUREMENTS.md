# Development resource measurements

These are dated observations on one development setup, not hardware requirements or performance guarantees. Each section identifies the installed build and measurement scope.

## Build 14 observations, September 13

Both installed applications were version 0.3.8, build 14, source `40d2fb7`. Times below are UTC.

| Platform | Observation window UTC | Samples | Largest sampled process tree | Largest sampled memory sum | Final native-process memory |
| --- | --- | ---: | ---: | ---: | ---: |
| Mac ARM64 | 08:49:59 to 08:55:31 | 67 | 5 processes | 306,380,800 bytes RSS (292 MiB) | 113,983,488 bytes RSS (109 MiB) |
| Windows x64 | 08:50:10 to 08:55:57 | 67 | 5 processes | 172,806,144 bytes working set (165 MiB) | 48,726,016 bytes working set (46 MiB) |

The samplers read process identifiers, parent identifiers and memory counters, then summed the installed application's process tree. They waited five seconds between reads. Query overhead made the actual intervals slightly longer, particularly on Windows. The windows included normal scheduled collection, without a manual refresh, application replacement, sleep or logout. Saved collection status reported success during the observation windows.

Both applications returned to one observed native process after collection. This does not establish leak freedom or a long-running idle baseline.

## Build 24 Mac observation, September 17

The installed Mac candidate from `73d1145` was sampled 73 times at five-second
intervals from 22:06:32 to 22:12:33 UTC. The largest observed descendant tree had
four processes and summed RSS of 285,786,112 bytes, about 273 MiB. At the final
sample only the native process remained, using 55,132,160 bytes RSS, about 53 MiB.
The native process accumulated 0.47 CPU seconds across the 360-second window.
That CPU counter excludes collector helpers and independent source services.

The window included scheduled collection. One observed collection completed
partially, reading 11 of 13 configured sources. Resource measurements do not
establish complete source health. No manual refresh, sleep or logout was used.
Short-lived helpers may fall between samples, shared pages may be counted more
than once, and this development-machine observation is not a controlled benchmark
or evidence of leak freedom.

## Build 25 Mac observation, September 17

The installed 0.3.13 build 25 from clean source `53fa934` was sampled 73 times at
five-second intervals from 23:22:28 to 23:28:28 UTC. The largest observed descendant
tree had four processes and summed RSS of 304,807,936 bytes, about 291 MiB. The
final sample contained one native process using 64,651,264 bytes RSS, about 62 MiB.
Its CPU counter increased by 0.63 seconds over the six-minute window. That counter
excludes collector helpers and independent source services.

The first collection was already running when sampling began. It and the next
scheduled collection completed successfully with 13 of 13 configured source reads.
The app returned to one observed native process after collection. No manual
refresh, application replacement, sleep or logout was used. This observation
includes the retained-history reader introduced in build 25, but does not measure
cold-cache scanning or prove complete historical capture. It is not a controlled
comparison with build 24 or a long-running leak test.

## Build 25 Windows observation, September 17

The installed 0.3.13 build 25 was sampled 73 times at five-second intervals from
23:34:03 to 23:40:03 UTC. The largest sampled process-tree working-set sum was
217,649,152 bytes, about 208 MiB. Up to eight descendant processes were observed.
The final sample contained one native process using 34,680,832 bytes, about 33 MiB.
Its CPU counter increased by 0.94 seconds over the six-minute window, excluding
collector helpers and independent source services.

The window captured a scheduled collection from 23:38:38 to 23:38:41 UTC that
completed with seven of seven configured source reads. The installed process did
not restart, and no manual refresh, replacement, sleep or logout was requested.
Source tests ran separately on the same development machine during part of this
window. This is an uncontrolled observation with a warm retained-history cache,
not a capacity limit, a cold-cache benchmark or a direct comparison with Mac RSS.
The WSL VM and independent source services are outside the measured native tree.

## Build 35 Mac observation, September 26–27 UTC

The installed 0.3.13 build 35 from `ced669854940f5892570a6a7a8feb1689b903b80`
was sampled 72 times at nominal five-second intervals from September 26 at
23:57:34.664 to September 27 at 00:03:29.716 UTC, a 355-second window. The largest
sampled descendant tree contained six processes including the native app, with
summed RSS of 341,884,928 bytes, about 326 MiB. The final sample contained only
the native app, using 52,379,648 bytes RSS, about 50 MiB. Its process identity
stayed stable. Native CPU time increased by 2.79 seconds, excluding descendant CPU.

A normal scheduled collection completed from 00:00:02.552 to 00:00:18.351 UTC.
Its saved status matched the snapshot timestamp and reported 14 of 15 configured
sources read. The intermediate running state was not sampled. The app retained
its 300-second collection interval, and no manual refresh or app restart was used.

This observation does not isolate individual adapter costs. Independent source
services are excluded. Short-lived helpers may be missed, and summed RSS may
count shared pages more than once. This is not a controlled comparison with
older builds, a maximum-memory bound, an energy measurement or a leak test.

## Build 35 Windows observation, September 27 UTC

The installed 0.3.13 build 35 from `7c7ae25541b8b6cc3c2529b6de5fc67de0f656a8`
was sampled 36 times from 00:03:48.393 to 00:06:48.462 UTC. Five-second delays
plus query overhead produced a 180-second window. The largest sampled tree had
five processes including the native app, with a summed working set of
318,660,608 bytes, about 304 MiB. The final sample contained only the native app,
using 62,955,520 bytes, about 60 MiB. Process identity remained stable, and native
CPU time increased by 0.359375 seconds, excluding child processes.

Sampling stopped after the first matched completed publication, below the
six-minute cap. Its collection ran from 00:06:38.513 to 00:06:46.938 UTC and
reported eight of eight configured source reads. No manual collection was
requested. Scheduled origin is inferred from this ordinary untriggered
publication, rather than independently verified through a scheduling control.

The measurement did not change the app, sharing settings or source configuration.
The working set excludes the WSL VM and independent source services. Short-lived helpers may
be missed and shared pages may be counted more than once. This warm development
observation is not a cold-cache benchmark, a leak test or a direct comparison
with Mac RSS.

## Web panel spike on Windows, October 13

Recorded on 2026-10-13 for issue 65. It compares the shared web panel in WebView2 with the native tray popup on one Windows PC. These are single runs on one machine. They are not requirements or guarantees.

### What was measured

- Source: `f9f444c` on the `win/web-panel-spike` branch, which is `main` at `7b2403c` plus the flagged panel host.
- Build: a staged folder, not an installed package. The app binary and the web bundle came from `f9f444c`. The collector scripts and the Node and Python runtimes were copied from the installed build 40 (`57518b7`). The installed app was quit for the runs and restarted afterwards.
- Start: each instance was started through `Win32_Process.Create`, so its parent was `WmiPrvSE.exe` and not the Claude desktop app, as issue 58 requires. Each used the real data folder and completed one collection before the first sample.
- Machine: Intel Core i7-14700F, 31.8 GiB of memory, Windows 11 Home build 26300, WebView2 Runtime 155.0.4283.45, display scale 100 percent, system appearance dark.
- Sequence: `--panel-timing` waits for one collection, then opens the panel once, holds it for 20 seconds, closes it, waits 75 seconds and opens and closes it five more times. The web runs added `--web-panel`.

### How the numbers were taken

- Open time starts where the tray click handler starts. It does not include the time Windows takes to deliver the click.
- For the web panel it ends when the window is visible, `window.observatoryPanelReady` is true and the window has been sized to the page. For the native popup it ends at the first idle message after the form is shown.
- The web view is created on the first opening and kept afterwards. Closing hides the window. A later opening shows that existing window, so later web opens measure showing a drawn page, not drawing one.
- Memory is the sum over the app's process tree, read from `Win32_Process` 12 seconds after each marker, or 1 second after the 60-second mark. Working set counts shared pages once per process, so the sum overstates what the tree holds. Private bytes are listed beside it.

### Open time

| Opening | Web panel, final code | Web panel, earlier run | Native popup |
| --- | ---: | ---: | ---: |
| First | 256.3 ms | 378.0 ms | 109.6 ms |
| Second | 5.7 ms | 3.9 ms | 19.6 ms |
| Third | 5.7 ms | 6.6 ms | 18.6 ms |
| Fourth | 3.9 ms | 2.7 ms | 17.2 ms |
| Fifth | 4.4 ms | 2.8 ms | 20.8 ms |
| Sixth | 3.8 ms | 3.6 ms | 18.1 ms |

The earlier web run used the same build before a change to how the window height is measured. The final run followed it by about three minutes, which may explain its shorter first open. Neither run started from a cold machine.

### Memory

| State | Web panel, final code | Web panel, earlier run | Native popup |
| --- | --- | --- | --- |
| Panel never opened | 1 process, 57.1 MiB working set, 17.0 MiB private | 1 process, 57.4 MiB, 16.9 MiB | 1 process, 57.1 MiB, 17.0 MiB |
| Panel open | 7 processes, 396.1 MiB working set, 181.5 MiB private | 7 processes, 409.8 MiB, 187.2 MiB | 1 process, 65.4 MiB, 20.2 MiB |
| One minute after closing | 7 processes, 405.3 MiB working set, 184.3 MiB private | 7 processes, 419.1 MiB, 190.6 MiB | 1 process, 68.3 MiB, 21.1 MiB |

The six extra processes are `msedgewebview2.exe`. They stay because the web view is kept. Disposing the web view on close was not built or measured, so the cost of a cold open on every click is not known.

### What was seen

- The panel drew with real data and matched the layout of the dark capture from pull request 63: header and freshness, limits card, device and period segments, totals card, source count and the four buttons. The update button shows the icon from pull request 67.
- Text used Inter Tight. The page reported the font as loaded and as the computed font of the panel element. The host serves the bundled `.ttf` file, which the existing dashboard host does not.
- The page followed the system dark appearance, with background `rgb(28, 29, 27)`. Light appearance was not tried.
- The page was 388 CSS pixels wide and the window was sized to 509 pixels, the height of the panel element.
- The harness pressed each of the four buttons in the page. The host accepted `refresh`, `check-updates`, `open-settings` and `open-dashboard` in that order. `refresh` started a collection, the snapshot changed and the page text changed after `observatory:snapshot-changed` was dispatched.
- With the real snapshot the panel showed one Codex limit window, a Claude Code limits row reading Unknown and "10 of 10 sources read". The collector reported 6 of 6 for the same snapshot. The two counts use different rules. That difference was not examined.

### Not exercised

- A physical click on the tray icon and on the page's buttons. The harness called the same handlers.
- What `check-updates`, `open-settings` and `open-dashboard` do after the host accepts them. The harness records them without running them, because they open windows. They map to the existing tray menu functions.
- Light appearance, display scales other than 100 percent, a second monitor, Escape to close and keyboard focus.
- An installed package. The Clean Windows package workflow was not run for this revision.
- Idle memory over hours, memory after many collections, and behaviour after sleep and wake.

### Left behind

`panel-timing.log` and `panel-timing.png` in the app's data folder. The image shows real usage values and stays out of this repository.

## Limits

- Processes that started and exited between samples can be missed. These are observed peaks, not maximum memory bounds.
- Independent ActivityWatch processes, the WSL VM, other source applications and helpers outside the descendant tree are excluded.
- Summed RSS or working sets can count shared pages more than once. They are not measurements of unique physical memory or directly interchangeable platform metrics.
- Normal development work continued on the machines. This was not a controlled benchmark, and sampler overhead is not included in the application totals.
- CPU during collection, energy use, long-running growth, larger histories, clean-machine behavior and sleep/wake resource recovery remain unverified.

The [release checklist](RELEASE-CHECKLIST.md) retains these open performance gates. Installer file sizes are separate from runtime memory.
