# Agent status

`npm run status -- --json` prints one JSON object. It is built by `lib/agent-status.mjs` from this computer's `combined.json` (`<data>/public/local/combined.json`). The command makes no network calls, starts no server and writes nothing. It holds engine, window and host ids, numbers, times and the forecast words the dashboard shows, with no device names, paths, prompts or accounts.

```json
{
  "schema": 1,
  "generatedAt": "2026-10-30T13:14:48.918Z",
  "current": true,
  "engines": {
    "claude": {
      "status": "ok",
      "headroom": 68,
      "effectiveHeadroom": 100,
      "pace": "spend",
      "windows": {
        "five_hour": {"percentLeft": 82, "resetsAt": "2026-10-30T17:00:00.000Z", "minutesToReset": 226, "burnPerHour": 14, "pace": "spend", "forecast": {"...": "as below"}},
        "weekly": {"percentLeft": 68, "resetsAt": "2026-10-30T22:00:00.000Z", "minutesToReset": 526, "burnPerHour": 3, "pace": "spend",
          "forecast": {"status": "room", "phrase": "has room", "sentence": "Claude has room.", "runsOutAt": null, "earliestAt": null, "latestAt": null,
            "leftAtReset": 41.5, "resetsLabel": "Resets Fri 6 PM"}}
      },
      "forecast": {"status": "room", "phrase": "has room", "sentence": "Claude has room.", "runsOutAt": null, "earliestAt": null, "latestAt": null,
        "leftAtReset": 41.5, "resetsLabel": "Resets Fri 6 PM", "headline": "Claude has room", "window": "weekly"}
    },
    "codex": {"status": "out", "headroom": 0, "effectiveHeadroom": 0, "pace": "out", "windows": {"five_hour": {}, "weekly": {}}}
  },
  "nextReturn": {"codex": {"resetsAt": "2026-10-30T14:15:32.000Z", "minutesToReset": 61}},
  "route": {
    "code": {"engine": "claude", "reason": "claude has 68% effective headroom, codex is out for 61 min."},
    "review": {"engine": "claude", "reason": "..."},
    "research": {"engine": "claude", "reason": "..."}
  },
  "cap": {"total": 10, "claude": 10, "codex": 0, "codexRunning": 1, "reason": "claude pace spend, 100% effective gives 10; codex out gives 0."},
  "forecast": {"asOf": "2026-10-30T13:14:30.000Z", "timeZone": "America/New_York", "sentence": "Codex is out until Fri 10:15 AM. Claude has room."},
  "devices": [{"host": "Mac", "state": "current", "stateLabel": "Fri 9:14 AM", "collectedAt": "2026-10-30T13:14:20.000Z"},
    {"host": "Windows", "state": "off", "stateLabel": "Off", "collectedAt": "2026-10-29T08:26:05.000Z"}]
}
```

## Fields

- `schema` changes only when a field is removed or changes meaning.
- `current` is true when at least one window has a current reading. The exit code is 0 when it is true and 3 when it is false.
- `percentLeft` uses the menu bar rule in `lib/glance-limits.mjs`. A reading older than 10 minutes, marked stale, or past its reset time is `null`. Unknown is never 0. A stale reading that has not reached its reset keeps its last value in `lastReading` (`percentLeft` and `asOfLabel`), the way the forecast dates an old claim. `lastReading` is `null` otherwise.
- `resetsAt` and `minutesToReset` are `null` when the reading is not current or the reset time is unknown.
- `burnPerHour` is percentage points used per hour on average since the window opened, from the one forecast the hub stores in `combined.json` (`glance.forecast`, made by `lib/forecast.mjs`). It is `null` when there is not enough history, and while the window is too new to forecast (pace `early`).
- `forecast` on each engine and window is that stored forecast, shown as stored. `sentence` and `phrase` are the words the dashboard, menu bar and tray show, worded in the user's time zone with the day always named. `runsOutAt` is when the window runs out at its present pace, and `earliestAt` and `latestAt` are the range past forecasts support. A "may run out from" sentence names `earliestAt`. `leftAtReset` is the share expected to be left at the reset. `resetsLabel` is the label the menu bar shows, such as "Resets Fri 5 PM". The engine's `forecast` also has `headline`, the menu bar's first line, and the `window` it is about. Every field is `null` when the stored forecast does not have it.
- `forecast` at the top has the stored sentence for all engines and when it was made (`asOf`). The sentence is `null` for a `combined.json` written before the forecast was stored with its words.
- `devices` has each computer's state, decided once by the hub: `current`, `late` (old snapshot or the last pull failed), `off` (turned off in the settings with `"off": true`) or `missing`. `stateLabel` is what every surface shows: "Off", "No snapshot" or the time of its last reading with its day.
- `status` is `out` when any current window is at 0, `unknown` when any window has no current number or no window has one, and `ok` otherwise. A window counts as missing, not unknown, only when the reading says the plan has none (`notReported`, as on Claude plans with no 5-hour window). The engine is then judged on the windows it has. A window the reading left out without saying so, or one whose reset has passed, is unknown.
- `headroom` is the lowest `percentLeft` across the engine's windows. It is 0 when any current window is at 0, and `null` when the engine is unknown.
- `effectiveHeadroom` is `percentLeft` scaled by time left: `percentLeft * windowMinutes / minutesToReset`, capped at 100 and never rounded down to 0 while anything is left. 100 means on or under the straight-line budget. The engine's value is the lowest across its windows.
- `nextReturn` has one entry for each engine whose `status` is `out`, with the `resetsAt` and `minutesToReset` of its window at 0 (the later one when both windows are at 0). Both are `null` when the reset time is unknown. It is `{}` when no engine is out.
- Account limits come from the freshest reading on either computer. They are never added across computers.

## Pace

For each window, from the stored forecast:

| Pace | Rule |
| --- | --- |
| `out` | `percentLeft` is 0. |
| `early` | The window is too new to forecast (`forecast.status` is `early`, and the words are "Too early to forecast"): less than a tenth of the window has passed since it opened, a day at most. That is about 17 hours of a weekly window, 30 minutes of a 5-hour window and a day of a 30-day window. A window whose length is unknown needs an hour and three readings of its own. No run-out time, burn rate or share at the reset is given then. A window with 25% or less left is never `early`, and neither is a runaway burn: at least 20 points used and at least three times the share of the window elapsed. |
| `slow` | The stored forecast says the window runs out before it resets (`forecast.status` is `runs-out`). |
| `spend` | The stored forecast expects at least 20 points (`SPEND_MARGIN`) left at the reset, so allowance would go unused. |
| `hold` | The stored forecast expects less than that left at the reset. |
| `unknown` | No current reading or no reset time. |

When the window has no stored forecast, the pace falls back to straight-line budgeting with `leftAtReset = percentLeft - burnPerHour * minutesToReset / 60`: `slow` at 0 or less, `spend` at 20 points or more, or on or under the straight-line budget (`percentLeft >= 100 * minutesToReset / windowMinutes`) with at least 20% left, and `hold` otherwise. The status never says `spend` while the dashboard says the window runs out.

An engine's `pace` is its most limiting window, in the order `out`, `slow`, `unknown`, `hold`, `early`, `spend`. An early window limits nothing, so a real verdict on the other window decides the pace.

## Route

An engine is usable when its `status` is `ok` and `effectiveHeadroom` is above 0. `route` is `null` for a task when no engine is usable. `route` is advice. Observatory does not start, stop or switch an agent.

- `code` goes to Codex unless Codex is low (`effectiveHeadroom` under 20 or `pace` `slow`) or all its slots are busy (`codexRunning >= cap.codex`). Then it goes to Claude. With Claude not usable, it still goes to a usable Codex, where it waits for a slot.
- `review` and `research` go to Claude when its `effectiveHeadroom` is at least Codex's (ties go to Claude), otherwise to Codex.

## Job cap

`cap` says how many jobs each engine may run at once. Claude counts sessions and subagents; Codex counts `codex-job` runs.

| Engine state | Slots |
| --- | --- |
| `out` | 0 |
| `unknown` | 1 |
| pace `spend`, or `early` with more than 25% left | the most: 10 for Claude, 5 for Codex |
| pace `early` with 25% or less left | as `hold` |
| pace `hold` | the most times `effectiveHeadroom` / 100, rounded up, at least 1 |
| pace `slow` | 1 |

`codexRunning` counts the `<id>.running` markers that `codex-job` and `codex-job-on` leave in `~/.local/state/codex-jobs` on this computer, or is `null` when that folder cannot be read. A marker's id ends in the wrapper's PID: it counts while that PID is a live `codex-job` process, however long the job runs, and never once the PID is gone. When the PID cannot be read or checked (Windows, no `ps`), a marker counts only while it is under 6 hours old, and `cap.reason` and the plain report say how many were counted that way.

## Waiting for an engine

`npm run status -- --wait <engine> [--timeout <minutes>]` blocks until the engine is no longer `out`, then prints the JSON above.

- When the engine is out and its reset time is known, the command sleeps until that time and reads `combined.json` again. Once the reset time has passed, the 0% reading is no longer current, so the engine stops being `out` without waiting for the next collection. When the reset time is unknown, it reads again every 30 seconds.
- A 0% reading that goes stale before its reset time still counts as out until that time has passed.
- It uses only timers and file reads. It makes no network calls and writes nothing.
- Exit codes: 0 when the engine is not out (at once if it was never out), 4 when the timeout passes first, 2 for an engine other than `claude` or `codex`, or for a timeout that is not a number above 0.
