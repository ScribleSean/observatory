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
    "codex": {"status": "out", "headroom": 0, "pace": "out", "windows": {"five_hour": {}, "weekly": {}}},
    "grokbot": {"status": "unknown", "headroom": null, "pace": "unknown", "windows": null}
  },
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

For each task, `route` names the engine with the highest `headroom` among engines with a current reading and allowance left, or `null` when there is none. All three tasks use the same rule today. GrokBot is never picked because Observatory cannot measure it. The hint is advice. Observatory never starts, stops or switches an agent.
