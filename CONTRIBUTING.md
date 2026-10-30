# Contributing

Thanks for helping. Observatory is small on purpose, so the best contributions are fixes, clearer wording and support for a source people already use.

## Before you start

- Observatory only reads. It does not start, stop or answer an agent, and it does not write to the tools it reads.
- Never show Unknown as zero. Keep activity, tokens, account limits, billed cost and estimates separate. Never add limits across computers, and label sums of time or tokens across computers "not deduplicated".
- Store nothing private: no window titles, prompts, messages, session names, arguments, environment variables or credentials. Check data from a second computer the same way as local reads.
- Read a source only while `observatory.config.json` lists it as `true`.
- The dashboard listens on 127.0.0.1 only and stays read-only. Observatory reaches the second computer over the user's own SSH alias, so don't add a network listener, a pairing service or a hosted account.
- One computer must work with no configuration beyond `npm run setup`. The apps target macOS and Windows. Tests also run on Linux, where tests that need the menu bar app, setup or the server skip with a reason.
- For anything larger than a fix, open an issue first so we can agree on the approach.

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

To work on the pages, run `npm run preview`. It serves the dashboard with fictional data at http://127.0.0.1:5602.

## Pull requests

- Keep each pull request to one change, with tests for the readers, the combine step or the server when you touch them.
- Pin every action in `.github/workflows/` to a full 40-character commit SHA, with the version it stands for in a comment, for example `uses: actions/checkout@<sha> # v4.4.0`. A tag can be moved to other code. `npm test` fails on an action pinned to a tag or branch.
- Use synthetic data in tests and examples. Never attach real usage records, logs or screenshots with your own projects in them.
- Write plainly in docs and interface text: full sentences, no em dashes or semicolons, no marketing language. Use "Unknown" for missing values.
