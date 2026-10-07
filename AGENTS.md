# Application boundaries

## Scope and priorities

- Observatory is Sean's personal app, built in public. This is a public-source application repository, not a private repo or a consumer product. Personal context repositories store only pointers and private operating policy, not application source or required dependencies.
- Prioritize reliable native Windows and Mac collection, with the Windows application/tray and Mac application/menu-bar experiences. Fix unresolved audit and UI issues before adding features. Keep the app lean and reuse working collectors and controls.
- WSL and Ubuntu tracking are no longer in scope. Do not add setup, recovery or collection work for them, or plan a standalone Linux app. Retiring support does not authorize stopping WSL workloads, deleting original logs or editing real configurations. Preserve saved evidence and test any source-scope migration before calling it complete.
- Reuse existing verified SSH connections for optional Mac/Windows pairing. Do not replace working transport just to create consumer onboarding, code/QR pairing or a hosted account service.
- Defer iPhone integration until supported OS permissions and data access are established. Defer integration with Hermes `/usage` commands until native collection is dependable, then reuse supported commands or adapters without a Hermes core fork. Do not imply either integration is already available.
- The fictional demo is a development fixture. Public installer marketing, hosted services, broad provider expansion and customizable dashboards are not current priorities. This scope does not authorize publication, pushes, releases or repository-visibility changes.

## Public writing

- Do not use em dashes in replies, UI copy, documentation, comments or other authored writing. Use sentences, commas or parentheses instead. Use "Unknown" for missing values.

- Use plain developer documentation with complete sentences and specific claims. Avoid slogans, dramatic fragments, marketing language and unnecessary jargon such as "local-only observability."
- Do not use semicolons in public prose. Code syntax is unaffected. Keep commands, links and factual limitations intact during editing.
- Use [Humanizer](https://github.com/blader/humanizer) as a review reference, not as proof that text is human-authored. It is a Markdown editing guide, not a trained model. Do not invent personal stories, metrics or claims to make writing feel natural.
- Private writing samples and personal context must not enter this public repo. More detailed private voice guidance can inform revisions when explicitly available.

## Data and execution boundaries

- $0 additional spend. No model calls are needed to collect existing records.
- Local-only delivery. Never deploy snapshots or raw source records, even to a private hosted URL, without new explicit authorization.
- Keep activity, tokens, account allowances, billed cost and estimates distinct. Preserve source provenance and original observation times. Unknown is not zero. No cross-host token or active-time sum until deduplication is verified.
- Authenticate device exchange, preserve revocation and require explicit source and sharing consent. Provider authentication is separate from pairing. Keep credentials on the owning device and use supported sign-in mechanisms.
- No raw titles, prompts, arguments, environment variables or credentials in stored dashboard data or Git. Test adapters using synthetic data.
- Local config and generated data remain ignored. Do not weaken private host bindings or turn the dashboard into a shell-command API.

## Verification and maintenance

- Read [product direction](docs/PRODUCT-DIRECTION.md), the [roadmap](docs/ROADMAP.md) and relevant dated audit evidence before choosing work. Do not repeat completed repairs or turn an unobserved interaction into a confirmed defect.
- Keep source, synthetic tests, packages, installed apps and live acceptance separate. Record the exact revision and what was exercised. A documentation change is not a new build, WSL removal, installation or verification result.
- Preserve historical release and audit records with their original dates and limitations. Mark older evidence as historical when linking from active guidance. Do not relabel artifacts or rewrite old results as current acceptance.
- Personal use does not waive safety, reproducibility, integrity, accessibility or recovery gates. Use isolated fictional fixtures, run the checks for the affected code, preserve recoverable state before replacement and verify the installed target before claiming success. Keep signing and clean-machine limitations explicit. Do not bypass platform security warnings.
