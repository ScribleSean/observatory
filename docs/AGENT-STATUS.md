# Agent status

`npm run status -- --json` prints one JSON object. It is built by `lib/agent-status.mjs` from this computer's `combined.json` (`<data>/public/local/combined.json`). The command makes no network calls, starts no server and writes nothing. It holds engine and window ids, numbers and times only, with no device names, paths, prompts or accounts.

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
        "five_hour": {"percentLeft": 82, "resetsAt": "2026-10-30T17:00:00.000Z", "minutesToReset": 226, "burnPerHour": 14, "pace": "spend"},
        "weekly": {"percentLeft": 68, "resetsAt": "2026-10-30T22:00:00.000Z", "minutesToReset": 526, "burnPerHour": 3, "pace": "spend"}
      }
    },
    "codex": {"status": "out", "headroom": 0, "effectiveHeadroom": 0, "pace": "out", "windows": {"five_hour": {}, "weekly": {}}}
  },
  "nextReturn": {"codex": {"resetsAt": "2026-10-30T14:15:32.000Z", "minutesToReset": 61}},
  "route": {
    "code": {"engine": "claude", "reason": "claude has 68% effective headroom, codex is out for 61 min."},
    "review": {"engine": "claude", "reason": "..."},
    "research": {"engine": "claude", "reason": "..."}
  },
  "cap": {"total": 10, "claude": 10, "codex": 0, "codexRunning": 1, "reason": "claude pace spend, 100% effective gives 10; codex out gives 0."}
}
```

## Fields

- `schema` changes only when a field is removed or changes meaning.
- `current` is true when at least one window has a current reading. The exit code is 0 when it is true and 3 when it is false.
- `percentLeft` uses the menu bar rule in `lib/glance-limits.mjs`. A reading older than 10 minutes, marked stale, or past its reset time is `null`. Unknown is never 0.
- `resetsAt` and `minutesToReset` are `null` when the reading is not current or the reset time is unknown.
- `burnPerHour` is percentage points used per hour over up to the last hour of readings, from `scripts/quota-pace.mjs`. It is `null` when there is not enough recent history.
- `status` is `out` when any current window is at 0, `unknown` when the weekly window or any other window has no current number, and `ok` otherwise. A window counts as missing, not unknown, only when the reading says the plan has none (`notReported`, as on Claude plans with no 5-hour window). A window the reading left out without saying so, or one whose reset has passed, is unknown.
- `headroom` is the lowest `percentLeft` across the engine's windows. It is 0 when any current window is at 0, and `null` when the engine is unknown.
- `effectiveHeadroom` is `percentLeft` scaled by time left: `percentLeft * windowMinutes / minutesToReset`, capped at 100 and never rounded down to 0 while anything is left. 100 means on or under the straight-line budget. The engine's value is the lowest across its windows.
- `nextReturn` has one entry for each engine whose `status` is `out`, with the `resetsAt` and `minutesToReset` of its window at 0 (the later one when both windows are at 0). Both are `null` when the reset time is unknown. It is `{}` when no engine is out.
- Account limits come from the freshest reading on either computer. They are never added across computers.

## Pace

For each window, with `leftAtReset = percentLeft - burnPerHour * minutesToReset / 60`:

| Pace | Rule |
| --- | --- |
| `out` | `percentLeft` is 0. |
| `slow` | `leftAtReset` is 0 or less, so the window runs out before it resets. Nothing promotes it. |
| `spend` | `leftAtReset` is at least 20 points (`SPEND_MARGIN`), so allowance would go unused. A `hold` window, or one with no burn rate yet, also reads `spend` when it is on or under the straight-line budget (`percentLeft >= 100 * minutesToReset / windowMinutes`) and has at least 20% left. |
| `hold` | Anything between, and a window with no measured burn rate that is not under budget. |
| `unknown` | No current reading or no reset time. |

An engine's `pace` is its most limiting window, in the order `out`, `slow`, `unknown`, `hold`, `spend`.

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
| pace `spend` | the most: 10 for Claude, 5 for Codex |
| pace `hold` | the most times `effectiveHeadroom` / 100, rounded up, at least 1 |
| pace `slow` | 1 |

`codexRunning` counts the `<id>.running` markers that `codex-job` and `codex-job-on` leave in `~/.local/state/codex-jobs` on this computer, or is `null` when that folder cannot be read. A marker's id ends in the wrapper's PID: it counts while that PID is a live `codex-job` process, however long the job runs, and never once the PID is gone. When the PID cannot be read or checked (Windows, no `ps`), a marker counts only while it is under 6 hours old, and `cap.reason` and the plain report say how many were counted that way.

## Waiting for an engine

`npm run status -- --wait <engine> [--timeout <minutes>]` blocks until the engine is no longer `out`, then prints the JSON above.

- When the engine is out and its reset time is known, the command sleeps until that time and reads `combined.json` again. Once the reset time has passed, the 0% reading is no longer current, so the engine stops being `out` without waiting for the next collection. When the reset time is unknown, it reads again every 30 seconds.
- A 0% reading that goes stale before its reset time still counts as out until that time has passed.
- It uses only timers and file reads. It makes no network calls and writes nothing.
- Exit codes: 0 when the engine is not out (at once if it was never out), 4 when the timeout passes first, 2 for an engine other than `claude` or `codex`, or for a timeout that is not a number above 0.
