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
      "pace": "spend",
      "windows": {
        "five_hour": {"percentLeft": 82, "resetsAt": "2026-10-30T17:00:00.000Z", "minutesToReset": 226, "burnPerHour": 14, "pace": "spend"},
        "weekly": {"percentLeft": 68, "resetsAt": "2026-10-30T22:00:00.000Z", "minutesToReset": 526, "burnPerHour": 3, "pace": "spend"}
      }
    },
    "codex": {"status": "out", "headroom": 0, "pace": "out", "windows": {"five_hour": {}, "weekly": {}}}
  },
  "nextReturn": {"codex": {"resetsAt": "2026-10-30T14:15:32.000Z", "minutesToReset": 61}},
  "route": {
    "code": {"engine": "claude", "reason": "claude has 68% effective headroom, codex is out for 61 min."},
    "review": {"engine": "claude", "reason": "..."},
    "research": {"engine": "claude", "reason": "..."}
  }
}
```

## Fields

- `schema` changes only when a field is removed or changes meaning.
- `current` is true when at least one window has a current reading. The exit code is 0 when it is true and 3 when it is false.
- `percentLeft` uses the menu bar rule in `lib/glance-limits.mjs`. A reading older than 10 minutes, marked stale, or past its reset time is `null`. Unknown is never 0.
- `resetsAt` and `minutesToReset` are `null` when the reading is not current or the reset time is unknown.
- `burnPerHour` is percentage points used per hour over up to the last hour of readings, from `scripts/quota-pace.mjs`. It is `null` when there is not enough recent history.
- `headroom` is the lowest `percentLeft` across the engine's windows. It is 0 when any current window is at 0, and `null` when any window is unknown.
- `nextReturn` has one entry for each engine whose `status` is `out`, with the `resetsAt` and `minutesToReset` of its window at 0 (the later one when both windows are at 0). Both are `null` when the reset time is unknown. It is `{}` when no engine is out.
- Account limits come from the freshest reading on either computer. They are never added across computers.

## Pace

For each window, with `leftAtReset = percentLeft - burnPerHour * minutesToReset / 60`:

| Pace | Rule |
| --- | --- |
| `out` | `percentLeft` is 0. |
| `slow` | `leftAtReset` is 0 or less, so the window runs out before it resets. |
| `spend` | `leftAtReset` is at least 20 points, so allowance would go unused. |
| `hold` | Anything between. |
| `unknown` | No current reading or no measured burn rate. |

An engine's `pace` is its most limiting window, in the order `out`, `slow`, `unknown`, `hold`, `spend`.

## Route

For each task, `route` names the engine with the highest `headroom` among engines with a current reading and allowance left, or `null` when there is none. All three tasks use the same rule today. The hint is advice. Observatory never starts, stops or switches an agent.

## Waiting for an engine

`npm run status -- --wait <engine> [--timeout <minutes>]` blocks until the engine is no longer `out`, then prints the JSON above.

- When the engine is out and its reset time is known, the command sleeps until that time and reads `combined.json` again. Once the reset time has passed, the 0% reading is no longer current, so the engine stops being `out` without waiting for the next collection. When the reset time is unknown, it reads again every 30 seconds.
- A 0% reading that goes stale before its reset time still counts as out until that time has passed.
- It uses only timers and file reads. It makes no network calls and writes nothing.
- Exit codes: 0 when the engine is not out (at once if it was never out), 4 when the timeout passes first, 2 for an engine other than `claude` or `codex`, or for a timeout that is not a number above 0.
