# Application boundaries

## Scope and priorities

- Observatory is Sean's app, built in public and open source. It should be usable by anyone who clones it on a Mac or a Windows PC without his setup. It is not sold. Personal context repositories store only pointers and private operating policy, not application source or required dependencies.
- Observatory is monitor-only. It never starts, stops or answers an agent, and never writes to the tools it reads.
- [The design notes](docs/HUB-PLAN.md) record the current design: each computer collects its own snapshot, an optional second computer is combined by the hub over the user's own SSH alias, and a small menu bar or tray app and a read-only dashboard show the result. Read them before changing a data format, the combine rules or the glance apps. `docs/history` holds the records of the full app up to build 44, which is kept on the `archive/full-app` tag.
- One computer must work fully with no configuration: `git clone` and `npm run setup`. The second computer is an optional add-on. At most one Mac and one Windows PC are supported.
- The second computer is reached with the user's own SSH alias. Do not add a network listener, a pairing service or a hosted account service.
- The apps target macOS and Windows. Tests may also run on Linux, where tests that need the menu bar app, setup or the server skip with a reason. WSL and Ubuntu tracking are out of scope.
- Defer iPhone integration until supported OS permissions and data access are established. Do not imply this integration is already available.
- There is no demo page or release until the owner asks for one. Builds are made locally by `npm run setup`. This scope does not authorize publication, releases, pushes or repository-visibility changes.

## Work and branches

- Work happens on branches and reaches `main` by pull request, or by a local merge the owner approves. One review per change. Tests cover the readers, the combine step, the local server and setup.
- Each change edits only the parts of shared documents that describe it.
- On Windows, a live check starts the tray app from the Start menu or at login, not from inside a Claude desktop session (issue 58).

## Public writing

- Do not use em dashes in replies, UI copy, documentation, comments or other authored writing. Use sentences, commas or parentheses instead. Use "Unknown" for missing values.
- Use plain developer documentation with complete sentences and specific claims. Avoid slogans, dramatic fragments, marketing language and unnecessary jargon such as "local-only observability."
- Do not use semicolons in public prose. Code syntax is unaffected. Keep commands, links and factual limitations intact during editing.
- Use [Humanizer](https://github.com/blader/humanizer) as a review reference, not as proof that text is human-authored. It is a Markdown editing guide, not a trained model. Do not invent personal stories, metrics or claims to make writing feel natural.
- Private writing samples and personal context must not enter this public repo. More detailed private voice guidance can inform revisions when explicitly available.

## Data and execution boundaries

- $0 additional spend. No model calls are needed to collect existing records.
- Local-only delivery. Never deploy snapshots or raw source records, even to a private hosted URL, without new explicit authorization.
- Keep activity, tokens, account allowances, billed cost and estimates distinct. Preserve source provenance and original observation times. Unknown is not zero. A cross-host token or screen-time sum is shown only next to the per-device numbers and labeled "not deduplicated", and it is Unknown when any device's value is Unknown. Only a sum whose deduplication is verified may drop the label. Account limits are never summed across hosts.
- A source is read only while the user's settings file lists it as `true`. Provider sign-ins stay in their own apps. Keep credentials on the owning device and use supported sign-in mechanisms.
- No window titles, prompts, messages, session names, arguments, environment variables or credentials in stored dashboard data or Git. Data pulled from another computer is checked the same way as local reads. Test adapters using synthetic data.
- Local config and generated data remain ignored. The dashboard listens on 127.0.0.1 only and stays read-only. Do not turn it into a shell-command API.

## Verification and maintenance

- Keep source, synthetic tests, installed apps and live checks separate. Record the exact revision and what was exercised. A documentation change is not a build or a verification result.
- Preserve historical release and audit records with their original dates and limitations. Mark older evidence as historical when linking from active guidance. Do not rewrite old results as current acceptance.
- Personal use does not waive safety, reproducibility, integrity, accessibility or recovery gates. Use isolated fictional fixtures, run the checks for the affected code, preserve recoverable state before replacement and verify the installed app before claiming success. Do not bypass platform security warnings.
