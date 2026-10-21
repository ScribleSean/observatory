# Security and privacy

Observatory runs on your own computers. It has no account, no hosted service and no network listener other than the dashboard on 127.0.0.1.

## What talks to what

- The dashboard server (`serve-local.mjs`) binds to 127.0.0.1. It answers only requests addressed to `127.0.0.1:<port>` or `localhost:<port>`, refuses cross-site reads, accepts only GET and HEAD, and serves only the built pages and `combined.json`. It has no write routes and runs no commands.
- The hub connects to each spoke with your existing SSH alias. It runs one fixed command that reads `usage.json` and one that writes `combined.incoming.json`, which the spoke merges itself. SSH runs in batch mode with strict host key checking and no agent, X11 or port forwarding. No Node or other program from this project is needed on the spoke for this.
- Codex limits are read by asking the installed Codex client. Claude Code limits are read with Claude Code's own `/usage` command. Both use the sign-in those apps already have. Observatory does not read or store credentials.
- No model requests are made.

## What is saved

`usage.json` and `combined.json` hold daily and hourly totals, model names, limit readings, agent status with project and session names, and the time each was observed. They do not hold prompts, responses, window titles, commands, job output, file paths or credentials.

Agent status is read from `~/.claude/sessions/<pid>.json` (status, session name, folder name and times only, never the `.key` files beside them or any transcript) and from the names of the files in `~/.local/state/codex-jobs` (never their contents). The readers are tested with synthetic logs that contain private text, and the tests check that the text does not appear in the output.

Local processes running as your user can read these files. That is the trust boundary. Do not expose the dashboard port to a network.

## Reporting a problem

For a security problem, use **Report a vulnerability** on the repository's Security tab, so it stays private until it is fixed. For anything else, open an issue. Never attach real usage records. Use synthetic examples.

The security notes and dependency review for the full app up to build 43 are kept in [docs/history](docs/history/SECURITY-BUILD-43.md).
