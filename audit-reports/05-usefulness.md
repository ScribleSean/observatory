# Product usefulness

Observatory is useful when it shows **recorded** screen time, Codex tokens, optional Codex quota, optional Wispr metadata, and (on some Mac setups) saved workflow receipts, with gaps labeled. It fails the README promise when those surfaces are empty for reasons the UI does not explain, or when charts look precise beyond what SOURCE-COVERAGE allows.

This report is about value and false confidence, not visual polish. Related files: `docs/SOURCE-COVERAGE.md`, `docs/USAGE-LIMITS.md`, `docs/TRACKING-REUSE.md`, `AGENTS.md` three-view and unknown-is-not-zero rules.

## What currently delivers value

### Screen time, when ActivityWatch is running

Foreground app intervals minus away time, mapped to a public category and recognized-app list, with overlap counted once for Combined (`docs/SOURCE-COVERAGE.md` Foreground app detail, `scripts/combine-activity.mjs`).

Useful for: roughly where the desktop was focused, Mac versus Windows, week bands with missing tracking muted.

Not useful for: typing versus idle in an app, "productivity", which device had attention during Device overlap, iPhone, WSL as its own desktop.

### Codex tokens, when logs exist on the collecting machine

Saved-log reads by day and model, cached input called out, All-host withheld without verification (`SOURCE-COVERAGE.md` All-host tokens). Native collectors share the settings-cache path (`collect-mac.mjs`, `collect-windows.mjs`).

Useful for: order-of-magnitude Codex use by day and model on that host.

Not useful for: subscription remaining (that is Allowances, Codex only), billed USD (API comparison is hypothetical), Gemini or Claude, deleted logs.

### Codex quota, when monitoring is on and the client answers

Read-only `account/rateLimits/read` via a short-lived app-server process (`SOURCE-COVERAGE.md` Account limits). Graphs and pace estimates. Retired Spark windows filtered. Peer quota separate and not summed (`USAGE-LIMITS.md`).

Useful for: recent Codex window remaining, if the observation is fresh.

Not useful for: other providers, stale bars that still fill (`02-ui.md` stale allowance), cross-account sums.

### Wispr metadata, when opted in and the SQLite store is readable

Counts, words, audio duration, not transcripts (`GUIDE.md` Optional dictation statistics). Device totals are not summed.

Useful for: whether dictation happened and roughly how much audio was retained.

Not useful for: "all voice time", ChatGPT voice, confirmed successful transcriptions (unfinished rows may be included).

### Demo

GitHub Pages demo is labeled synthetic (`app/page.tsx` 299 to 301, `scripts/demo.mjs`). It is useful for UI exploration. It overrepresents completeness (combined totals, allowances, agents) compared with a fresh native install.

## When the app fails to deliver promised value

### 1. No public installer

README: public installers are being prepared, not yet available. Product direction item 1 is download and install without developer tooling (`docs/PRODUCT-DIRECTION.md` line 9). Until that ships, the product is a development-machine preview. Usefulness for "any developer with Mac and Windows" is gated on building from source.

This audit does not ask Codex to invent signing or notarization. It does ask that in-app chrome not imply a finished consumer installer.

### 2. Screen time depends on a second product the wizard treats as a checkbox

Without ActivityWatch, Observatory cannot show screen time. The README table still leads with Screen time. First-run can complete with activity enabled and still show Unknown. See P0-3.

### 3. Cross-device totals are a pairing research program, not a default

Roadmap milestone 2: both apps show combined data from the two devices, still an implementation target (`docs/ROADMAP.md` lines 16 to 17). Native collectors leave combined totals unavailable rather than summing mirrored logs (`SOURCE-COVERAGE.md` line 41, `MAC.md` Independent local collector).

Fresh installs are unpaired (`SOURCE-COVERAGE.md` line 9). SSH pairing is expert-only. TLS pairing is unverified on two real devices (`LOCAL-PAIRING.md`).

Until pairing works for a normal user, "across your devices" is only true for the legacy SSH hub (`GUIDE.md`) or the development pair described in PRIVATE-SYNC.md.

### 4. Workflows are mostly absent on the path README describes

New native Mac: receipts and benchmarks default off and need leftover `local.config.json` (`NativeSettings.swift` 64 to 72, `CollectorConfiguration.defaults`). Native Windows never collects them (`01-features.md`). Peer merge clears agents (`peer-payload.mjs` 103 to 105).

A user who opens Sources looking for Antigravity will often see not-connected. GUIDE's "four named receipt files" does not match the 128-file scanner.

### 5. Provider account management is missing

Cannot add, switch, or remove provider accounts in Observatory. Codex must already be signed in on the device. Other providers' remaining allowance is explicitly out of scope (`SOURCE-COVERAGE.md` last bullet) but README AI usage still sounds provider-general ("available account limits").

### 6. Automatic updates missing

Installed builds do not receive `git push` (`docs/UPDATES.md`). Users on build 14 versus source 23 will see docs for controls they do not have (Tailscale check, archive browser). That is a usefulness and trust problem: Settings copy about version versus "downloading an update does not change this version" (`NativeSettings.swift` 34) is accurate, but there is still no in-app update action.

## False confidence risks

AGENTS.md: unknown is not zero. No cross-host token or active-time sum until deduplication is verified. The code mostly obeys this. Residual risks:

| Risk | Why it looks true | Mitigation already in code | Remaining hole |
| --- | --- | --- | --- |
| Token $ is spend | Model rows show USD | Hypothetical / not a bill labels | Large type, easy to screenshot without caption |
| Allowance bar is current | Progress fill | Stale labeled "saved reading" | Bar still fills (`QuotaPanel` / Windows meters) |
| All sources read | Green dot N of M | Counts from snapshot | Ignores pause, stale quota, AW not actually tracking (`Panel.swift` 76 to 78) |
| Combined time is attention | Combined host | Device overlap category | Users may still treat Combined as "I used both" |
| ChatGPT dictation is coming | Filter + coming soon | not-supported / unverified | Filter implies a product surface |
| Pairing acknowledged means syncing | Success alerts | "does not verify live data sync" | Easy to miss. PRODUCT-DIRECTION forbids labeling reachable as syncing |
| Sharing enabled means history arrived | Toggle | "consent, not proof" | Easy to skim |
| Source status ok means watcher is running | Health table | Check time, tracking coverage on Activity | Per SOURCE-COVERAGE, check time is the read, not last user activity. Sleep and stopped watchers produce stale coverage |
| Period headline time is complete | Large total | App breakdown can be withheld | `nativePeriodSummary` can show totals while apps withheld (Mac audit) |
| Demo completeness | Full fictional week | Synthetic demo label | Users judging product fit from Pages only |

Hypothesis (unverified in this environment): Combined **activity** does not use the same `verification.status == "verified"` gate as combined **tokens** (`Snapshot.Latest` tokens versus activity). If true, Combined active time could appear while All tokens are withheld. Codex should confirm in `native/windows/Snapshot.cs` and Mac `Snapshot.swift` before changing either rule. Do not loosen token verification to match activity.

## SOURCE-COVERAGE gaps that block promised breadth

Already documented as needing a separate approach (`SOURCE-COVERAGE.md` Gaps):

- iPhone / DeviceActivityReport (not a plug-in)
- Gemini export (not a token bill, no importer)
- General SSH / shell history (deliberately off)
- Claude / Gemini live limits (Codex quota is not a substitute)
- ChatGPT voice (unverified)
- Nested tool calls inside wrappers (not reconstructed)

README is mostly honest about these. The UI still lists iPhone and Gemini as coverage-still-missing chips in Sources (`app/page.tsx` around 865 to 871), which is good, as long as they are not shown as disconnected integrations.

Additional implementation gaps not always obvious in that doc:

- Web ignores `peerQuota` (`01-features.md`).
- Independent native combined totals need pairing freshness of ten minutes (`peer-payload.mjs` line 97). An overnight peer is Combined unavailable, not "zero on the other device".
- Legacy versus native token accounting differs (settings versus daily reports, `SOURCE-COVERAGE.md` lines 11 to 13). The UI does not say which pipeline produced the snapshot.
- `typewhisper` retired. Older docs or configs mentioning it should not re-enable it (`MAC-MIGRATION.md`).

## Three-view distinction

AGENTS.md: preserve the three-view distinction and source provenance. In the UI this is Activity versus Tokens versus Allowances (plus Dictation and nested workflows). Mixing them causes false confidence:

- Editor category time is not Codex tokens.
- Codex tokens are not remaining quota.
- Quota remaining is not API-estimate dollars.
- AI app foreground time is not model execution (`WINDOWS.md` line 27, web "Foreground ≠ focus").

These separations exist in copy. Hierarchy still leads with Allowances, which can make quota the "main number" even when the user's question was screen time.

## When Codex should not "improve usefulness" by filling gaps

Do not:

- Infer ChatGPT voice from ChatGPT window time (`voice-overview.mjs` comment line 8).
- Sum dictation hosts.
- Sum peer quota into local quota.
- Publish All-host tokens without verification.
- Treat missing ActivityWatch as zero activity.
- Reconstruct unlogged requests.
- Deploy snapshots or raw records (`AGENTS.md` local-only delivery).

Usefulness repairs that are in scope: empty-state next steps, provenance labels (which collector, unpaired versus verified combined), hiding stub filters, aligning README with what a fresh native install actually shows.
