# Raw archive

Observatory rewrites its snapshot on every run, and its readers keep only recent days: model drift keeps 45 days, Codex limit history keeps a capped number of samples, and the current-only parts (limits, projects, live sessions) are replaced each time. To keep everything, set a folder in `observatory.config.json`:

```json
"archive": { "folder": "/absolute/path/to/archive" }
```

After every run, each computer appends its own new readings there. On the hub, the snapshots it read from the other computers in that run are appended as well. Nothing in the folder is ever rewritten or deleted. A `README.md` written into the folder on first use describes the same format for anyone who reads the files without this repository. A README an earlier version of Observatory wrote gets the screen time notes appended. A README you wrote yourself is left as it is.

## Files

`<host>/<YYYY>/<YYYY-MM-DD>.jsonl`, where `host` is `Mac`, `Windows` or `Linux` and the date is the day the line was written, in the writing computer's time zone. Folders are created readable by the owner only.

## Lines

Each line is one JSON object:

| Field | Meaning |
| --- | --- |
| `v` | Format version, now 1. |
| `archivedAt` | When the line was written (ISO 8601). |
| `host` | The computer the reading is from. |
| `collectedAt` | When that computer took the reading. |
| `section` | The snapshot section, for example `providerTokenSources`, `modelDrift`, `activityHistory`, `ledgerHistory`, `claudeLimits`. |
| `part` | The provider or tool inside the section, or empty. |
| `date` | The day a daily reading covers (YYYY-MM-DD), or null. |
| `kind` | `day` (one day of a daily section), `point` (one limit reading) or `row` (the rest of a section). |
| `value` | The reading exactly as the snapshot held it. |

## When a line is written

- A `day` or `row` reading is written when it changed since its last line. While a day is still the current day, that is at most once an hour. Once the day has ended, its final value is written at the next run.
- A `point` is written once, when it first appears.
- To get the latest value of a reading, take the last line with the same `host`, `section`, `part`, `date` and `kind`.

Unknown is never written as zero: a value the snapshot did not have stays missing or null. The index that tells which readings were already written lives in the data folder (`private-archive/index.json`). If it is lost, some readings are written twice and none is lost.

## Screen time

On a Mac with screen time on, two more kinds of line are written (see [Screen time](SCREEN-TIME.md)):

- `activityHistory` day lines carry `myApps` (seconds per label your `activity.apps` rules name), `browserUnmatched` (browser seconds no rule matched) and `browserHidden` (the part of those with no title, see [Screen time](SCREEN-TIME.md)).
- `activityEvents` lines hold each ActivityWatch window event once: `part` is the watcher's bucket, `kind` is `event`, `date` is the day the event started, and `value` is `{timestamp, duration, app, label}` with the duration in seconds. `label` is the app your `activity.apps` rules matched, `browser` for a browser window no rule matched, or `unmatched` for any other window. A rule cannot use `browser` or `unmatched` as its label. Labels are the rules in force when the event was written and are not changed later. Window titles are not written: they are only used, in memory, to match the rules. The first run writes every event the watchers hold. A watcher's newest event is written once a newer one follows it, since ActivityWatch can still lengthen it. Which events were written is kept in `private-archive/activity-events.json`.
