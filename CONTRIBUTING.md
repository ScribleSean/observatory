# Contributing

Thanks for helping. Observatory is small on purpose, so the best contributions are fixes, clearer wording and support for a source people already use.

## Before you start

- Read [AGENTS.md](AGENTS.md) for the project's rules. The short version: Unknown is never shown as zero, limits are never added across computers, and nothing private (prompts, messages, titles, credentials) is stored.
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
- Use synthetic data in tests and examples. Never attach real usage records, logs or screenshots with your own projects in them.
- Write plainly in docs and interface text: full sentences, no em dashes, no marketing language.
