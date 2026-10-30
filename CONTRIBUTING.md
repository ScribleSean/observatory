# Contributing

Thanks for helping. Observatory is small on purpose, so the best contributions are fixes, clearer wording and support for a source people already use.

## Before you start

- Observatory only reads. It never starts, stops or answers an agent, and it never writes to the tools it reads.
- Unknown is never shown as zero. Activity, tokens, account limits, billed cost and estimates stay separate. Limits are never added across computers, and sums of time or tokens across computers are labeled "not deduplicated".
- Nothing private is stored: no window titles, prompts, messages, session names, arguments, environment variables or credentials. Data from a second computer is checked the same way as local reads.
- A source is read only while `observatory.config.json` lists it as `true`.
- The dashboard listens on 127.0.0.1 only and stays read-only. The second computer is reached over the user's own SSH alias, so don't add a network listener, a pairing service or a hosted account.
- One computer must work with no configuration beyond `npm run setup`. The apps target macOS and Windows. Tests also run on Linux, where tests that need the menu bar app, setup or the server skip with a reason.
- For anything larger than a fix, open an issue first so we can agree on the shape.

## Working on it

```bash
npm ci
```

```bash
npm test
```

```bash
npm run lint
```

`npm run preview` serves the dashboard with fictional data at http://127.0.0.1:5602, which is the easiest way to work on the pages.

## Pull requests

- Keep each pull request to one change, with tests for the readers, the combine step or the server when you touch them.
- Pin every action in `.github/workflows/` to a full 40-character commit SHA, with the version it stands for in a comment, for example `uses: actions/checkout@<sha> # v4.4.0`. A tag can be moved to other code. `npm test` fails on an action pinned to a tag or branch.
- Use synthetic data in tests and examples. Never attach real usage records, logs or screenshots with your own projects in them.
- Write plainly in docs and interface text: full sentences, no em dashes or semicolons, no marketing language. Use "Unknown" for missing values.
