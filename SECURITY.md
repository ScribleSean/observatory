# Security and privacy

Observatory runs on your own computers. It has no account, no hosted service and no network listener other than the dashboard on 127.0.0.1.

## What talks to what

- The dashboard server (`serve-local.mjs`) binds to 127.0.0.1. It answers only requests addressed to `127.0.0.1:<port>` or `localhost:<port>`, refuses cross-site reads, accepts only GET and HEAD, and serves only the built pages and `combined.json`. It has no write routes and runs no commands.
- The hub connects to each spoke with your existing SSH alias. It runs one fixed command that reads `usage.json` and one that writes `combined.incoming.json`, which the spoke merges itself. SSH runs in batch mode with strict host key checking and no agent, X11 or port forwarding. No Node or other program from this project is needed on the spoke for this.
- Observatory reads Codex limits by asking the installed Codex client, and Claude Code limits with Claude Code's own `/usage` command. Both use the sign-in those apps already have. Observatory does not read or store credentials.
- Observatory makes no model requests.

## What is saved

`usage.json` and `combined.json` hold daily and hourly totals, model names, limit readings and the time each was observed. For each agent session they also hold its title, as the tool named it, plus its counts, model names and the folder names of the repositories it wrote to. They do not hold prompts, responses, window titles, commands, file paths or credentials.

Session titles are on by default. They stay on your computers, but with several computers they travel to the hub over your own SSH connection and back in `combined.json`. Set `"sessions": { "titles": false }` to replace each title with a short hash, keyed with a random secret that is made once per install and never leaves the computer. A hub with titles off also hashes the titles it receives from the other computers before it writes `combined.json`.

The collector keeps a private cache in the data folder (`private-ledger/`) so it can resume reading the agents' transcripts where it stopped. The cache holds file locations, working folders, read positions and short hashes of tool inputs. It is never copied into `usage.json` or `combined.json` and never leaves the computer. The title hash secret is kept next to it.

The tests feed the readers synthetic logs that contain private text and check that the text does not appear in the output.

Local processes running as your user can read these files. That is the trust boundary. Do not expose the dashboard port to a network.

## Reporting a problem

For a security problem, use **Report a vulnerability** on the repository's Security tab, so it stays private until it is fixed. For anything else, open an issue. Never attach real usage records. Use synthetic examples.
