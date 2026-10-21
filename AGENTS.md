# Application boundaries

## Scope and priorities

- Observatory is Sean's app, built in public. It should be usable by anyone who installs it on a Mac or a Windows PC without his setup. It is not sold. This is a public-source application repository. Personal context repositories store only pointers and private operating policy, not application source or required dependencies.
- [The design direction](docs/DESIGN.md) records the agreed product and interface direction. [The parity table](docs/PARITY.md) records what each platform has. Read both before changing an interface, a shared script or a data format. [The build plan](docs/BUILD-PLAN.md) lists the workstreams, the paths each one owns and the rules every session follows.
- Prioritize reliable native Windows and Mac collection, with the Windows application/tray and Mac application/menu-bar experiences. Fix unresolved audit and UI issues before adding features. Keep the app lean and reuse working collectors and controls.
- WSL and Ubuntu tracking are no longer in scope. Do not add setup, recovery or collection work for them, or plan a standalone Linux app. The apps no longer show Ubuntu history or read WSL source settings. Ubuntu fields remain in the pairing code and saved-snapshot format until both apps can be updated together. Removal does not authorize stopping WSL workloads, deleting original logs or editing real configurations. Test any source-scope migration before calling it complete.
- Keep the existing verified SSH pairing working. The intended pairing route for other people is the installed Tailscale client for reachability with an invitation, copied on the first device and pasted on the second, for trust. The build plan's "pairing code" means this invitation. Do not remove the SSH path until the new path is verified on both devices. A hosted account service is not planned.
- Defer iPhone integration until supported OS permissions and data access are established. Do not imply this integration is already available.
- The fictional demo mirrors the native apps and doubles as the product page. It contains fictional data only. Builds stay unsigned, with install guides that state the platform warnings plainly. Hosted services and broad provider expansion are not current priorities. Skins are planned as data files, as the design direction describes. Dashboard content follows the design direction. This scope does not authorize publication, releases or repository-visibility changes, with one exception the owner approved: when everything in the build plan's "What done means" is verified on both devices, workstream F1 publishes one GitHub release and the demo page, once, with no further confirmation. Branch pushes and pull requests follow the roles in the build plan's "Who does what", and merges follow its standing approvals.

## Sessions and branches

- One Claude orchestrator session on the Mac plans, reviews, builds, commits and opens and merges pull requests. Codex writes code and tests on the Mac, one worktree per branch under `.claude/worktrees/`. The Claude session on the Windows PC writes and verifies Windows native code and runs Windows acceptance checks. Reviewer sessions start with a fresh context. They coordinate only through files, issues and pull requests in this repository. [The build plan](docs/BUILD-PLAN.md) records the roles and the exact Codex command.
- Branch names start with `shared/` for shared scripts, viewer, documents and CI, `mac/` for Mac native work and `win/` for Windows native work. Every change reaches `main` by pull request.
- Each workstream owns the paths the build plan lists for it. `docs/DESIGN.md`, `docs/PARITY.md` and `docs/STATE.md` are shared records: a pull request edits only the rows or sections that describe its own change, and the orchestrator resolves conflicts at merge.
- Issues labelled `mac` or `windows` describe work for that session, including what to port from the other platform and how it should look.
- On Windows, an acceptance check must start the app outside a Claude desktop session. See issue 58.

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
- Authenticate device exchange, preserve revocation and require explicit source and sharing consent. Provider authentication is separate from pairing. Keep credentials on the owning device and use supported sign-in mechanisms.
- No raw titles, prompts, arguments, environment variables or credentials in stored dashboard data or Git. Test adapters using synthetic data.
- Local config and generated data remain ignored. Do not weaken private host bindings or turn the dashboard into a shell-command API.

## Verification and maintenance

- Read [product direction](docs/PRODUCT-DIRECTION.md), the [roadmap](docs/ROADMAP.md) and relevant dated audit evidence before choosing work. Do not repeat completed repairs or turn an unobserved interaction into a confirmed defect.
- Keep source, synthetic tests, packages, installed apps and live acceptance separate. Record the exact revision and what was exercised. A documentation change is not a new build, WSL removal, installation or verification result.
- Preserve historical release and audit records with their original dates and limitations. Mark older evidence as historical when linking from active guidance. Do not relabel artifacts or rewrite old results as current acceptance.
- Personal use does not waive safety, reproducibility, integrity, accessibility or recovery gates. Use isolated fictional fixtures, run the checks for the affected code, preserve recoverable state before replacement and verify the installed target before claiming success. Keep signing and clean-machine limitations explicit. Do not bypass platform security warnings.
