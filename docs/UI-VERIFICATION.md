# Native interface verification

Revision-specific development-machine checks. These results are not a full accessibility review or a clean-install result. Older candidate references below are historical, not the current installed version.

## Mac build 30 package and replacement, September 22

Mac build 30 from `106f607421c17ba551cb78bb14ffe4f678ba9428` passed package and replacement checks. See the [release record](RELEASE-0.3.13.md#mac-build-30-verification-september-22-utc) for exact artifacts and validation.

After unlock, the installed app exposed native Allowances and all seven navigation destinations through its accessibility tree. Selecting Source health failed at the control connection; resetting the control tool and restarting the app normally did not restore interaction. A process sample showed the app in its normal idle event loop, and source review found no demonstrated rendering defect. Visual, motion, keyboard and screen-reader checks remain open. Agent receipts recovered in an app collection at 04:03:08 UTC before the restart or diagnostic shell read; ActivityWatch remained unavailable. The earlier timeout cause is unconfirmed. Windows now runs build 30 after successful package, TEST installer lifecycle, hosted synthetic signed-update, and ordinary-upgrade/runtime checks; those checks are not Windows UI acceptance.

## Installed build 29 review, September 22

At this review, both development devices ran build 29 from `c23ad3b`. On Mac, Settings was reviewed in light and dark appearances at a standard window size, and Tokens and Activity were reviewed with all seven sidebar destinations, including Agents, present. The 02:47:18 UTC collection reported 12 of 13 reads because ActivityWatch was unavailable; the compact panel reported that point-in-time status without presenting missing data as zero. A later scheduled collection also missed the shared Mac Codex read used by Tokens and Settings. That read recovered automatically at 03:06:20 UTC, restoring 12 of 13 reads. The transient failure's cause is not established. These are point-in-time source checks. Windows build 29 had already completed a seven-source verification.

On Mac, the saved-account archive was checked through account selection, all-saved-date selection, loading, Day/Week/All retained graphs, dashed unknown gaps and raw-record pagination. Command-Return loaded the selected range. Command-Right while a date field held focus did not demonstrably page, so this is not claimed as a verified shortcut. Legacy pairing and direct-pair preview were opened and cancelled; the direct-pair cancellation retained saved state and did not create an invitation or identity.

The review found long-history date clipping and an Activity chart without an axis unit. The source repair in `2cec866` passed Swift compilation and native self-tests. Synthetic previews with bundled fonts cover 30 dates at wide and narrow widths, including 200% text, plus the centered single-day label. Dates remain readable and Activity ticks include minutes. The repair also adds explicit accessibility labels and values to detail rows, whose spoken output still needs verification. These changes are not part of installed build 29. Motion and reduced-motion behavior, complete native accessibility, and actual Windows tray interaction remain unverified. The Mac main process was observed idle in its normal AppKit event loop with no child process left behind; this is not evidence of every lifecycle path.

## Mac saved history follow-up, September 16

A disposable copy of candidate source `73d1145` ran its synthetic archive preview
with a separate bundle identifier. Opening the account menu by mouse and using
Down/Return selected the first synthetic account. Command-Return loaded the
full-range graph with 105 observations. Command-Right Arrow reached the final
five raw records, with Next page disabled. Tab entered the date editor popup.
Escape dismissed that popup, and a second Escape dismissed the history sheet.
The remaining preview host window was closed separately, after which the process
exited with status 0 and an empty captured log.

The accessibility tree exposed the account and record selectors, date editors,
load/pagination actions, graph observation count and end-of-range status. This is
current-candidate interaction evidence, not a full keyboard-only, screen-reader,
contrast or enlarged-layout review. Only fictional history was used. The normal
installed app and saved settings were not changed.

## Mac saved allowance history, September 14

A later preview-only `--preview-light` option allows testing without changing the system appearance. The empty and populated history sheet were inspected in light mode at the tested 760-point width. Controls, row text and the footer were visible, with scrolling confined to records. Loading the first synthetic account returned 100 readings. The isolated process exited without captured warnings. This is a light-mode spot check, not an enlarged-text or contrast-ratio audit, and the preview option is not included in the retained build 20 artifacts.

A keyboard spot check on build 20 found that Tab cycled through the date editor components without reaching action buttons under the current Mac keyboard settings. Opening the account menu by mouse and using Down/Return selected an account correctly. No global keyboard preference was changed. Full keyboard-only navigation remains unverified.

The subsequent history-sheet change adds Command-Return to load, Command-Right Arrow for the next page, and Escape to dismiss. An isolated native build passed self-tests and verified the load shortcut returning 100 synthetic readings, next-page returning the final five, and a repeated next-page shortcut doing nothing at the end. With no account selected, the disabled load action did not read history. Escape first closed an active date-editor popup and then dismissed the sheet on the next press. The process exited without captured warnings. Disabled history buttons are now dimmed, visually checked in light mode. These shortcuts improve action access but do not establish a complete keyboard-only account/filter workflow or screen-reader coverage. This change is not in the retained build 20 artifacts.

The build 19 history view was exercised in a separate synthetic preview using its real local archive process. The fixture held 105 allowance observations for one account group and three for another, with separate daily reports and collection checks. It did not contain real account history.

- The first account returned 100 readings, then five on the final page. Next page disabled at the end.
- Changing account or record kind cleared old rows and required a fresh load. The second account showed only its three daily reports.
- A date range without observations displayed an explicit missing-data message, not zero usage. Reversed dates disabled Load history. A same-day range returned the three expected collection checks.
- First accounts reset selection and rows. Done dismissed the sheet. The preview process exited and removed its synthetic runtime.
- The dark sheet fit the tested 760-point-wide viewport, with scrolling confined to the record list and the controls and explanatory footer visible.

SwiftUI emitted AttributeGraph cycle warnings during the interaction session. The observed controls still completed their actions, but the cause remains unresolved. Light mode, larger text, full keyboard/screen-reader behavior and additional window sizes have not been verified.

The warnings were subsequently reproduced specifically by loading after a date editor gained focus. Disabling the entire sheet during the read also disabled that focused editor. The correction leaves filter controls enabled and invalidates pending replies when filters change or the sheet closes. Native self-tests cover request invalidation and supersession. The previously failing date-edit/load sequence, populated same-day reads and final-page navigation were repeated without warnings. The synthetic process exited cleanly, with only the installed process remaining. This is a focused regression result, not a full SwiftUI or accessibility audit. The fix targets 0.3.11 build 20 and is not in the earlier 0.3.10 artifacts.

The UI inspection tool reopened the temporary app without preview arguments after its exit. That exact temporary process was gracefully stopped, and the installed process was independently confirmed still running. No installed bundle was replaced. Do not treat this session as proof that no live collection occurred during the brief unintended normal launch.

## Mac allowance accessibility follow-up, September 13

The installed 0.3.8 dashboard exposed the saved pace estimate and reset comparison through its accessibility tree. However, combining the entire allowance card into one accessibility element merged the remaining-allowance progress value with the separate time-coverage label. These percentages measure different things.

Source now keeps the card's children separately accessible and explicitly labels the allowance-remaining bar. The reset-coverage bar retains its own label and percentage. Swift typechecking passed without launching or replacing an app. A rebuilt native accessibility-tree and screen-reader check remain required before claiming this correction works in the installed interface.

## Windows optional-network settings, September 13

The synthetic native dashboard test passed for source `62f0860`, including an injected Tailscale readiness callback. Entering the device-settings page did not invoke that callback. Selecting **Check Tailscale** invoked it once and displayed its fictional result. The test did not read or modify a real VPN configuration or open the setup website.

The device-settings capture was inspected after correcting the guide link's dark-background contrast. The status, action and guide were visible. This is not a full settings accessibility audit or a packaged live-client integration check. The ordinary installed app was not replaced.

## Mac candidate `7d3b2cc`

The checks used an isolated `--preview --show` launch with collection sources disabled. The installed application and its collector were not replaced. The shared web assets were built on Windows and packaged into the Mac candidate.

| Check | Observed result |
| --- | --- |
| Vertical view rail | Up/Down moves keyboard focus; Enter activates the focused view. Activity to Tokens and back was verified in WebKit. |
| Horizontal device tabs | Right and Enter moved from Combined to Mac after the orientation fix. |
| Focus indication | Keyboard focus has a visible outline. This is a spot check, not an exhaustive focus-order audit. |
| Inactive panels | Returning from Tokens to Activity no longer leaves the inactive Tokens panel drawn underneath. Verified by scrolling and inspecting the rendered window. |
| Empty states | Activity, Tokens, Agents, Dictation and Sources expose named views and unavailable-state text, rather than invented usage totals. |
| Minimum window | All five empty-data views were inspected at the configured 800-by-550-point minimum. Visible controls and text fit the width; longer content requires vertical scrolling. This does not establish populated-table or enlarged-text behavior. |
| Build checks | Windows tests passed (121 pass, eight platform skips), with TypeScript and both UI builds passing. Mac signature, self-test, bundled-collector, WebKit and three-cycle window-lifecycle checks passed. |

The tab wrapper previously styled a vertical rail without forwarding its orientation to the underlying component. It now forwards that property. The Mac renderer smoke test checks the actual desktop tablist's `aria-orientation`, after allowing React to mount. Inactive panels are explicitly hidden while the tab component finishes its unmount transition.

## Selection follow-up, candidate `4731c97`

The visual rail highlight remained on Activity after switching views in the earlier preview, including with direct clicks and after raising the window. Tab-selection color transitions are now disabled, so selection feedback does not depend on animation progress. In the rebuilt Mac preview, Sources and Tokens highlighted correctly, and the horizontal Mac token tab matched its selected accessibility state. Right and Enter activation also remained functional.

The same check exposed Windows-specific disconnected-source text in the Mac token view. The message is now source-neutral and was verified in the native Mac preview. Both UI builds and the Mac signature, self-test, bundled-collector, WebKit and window-lifecycle checks passed for this candidate. These fixes do not change collection settings or install a new version over the working app.

## Mac enlargement follow-up, candidate `4209a65`

The Mac dashboard now provides 75% to 200% page zoom through its View menu and window-local keyboard handling. Native self-tests cover each zoom step, both limits, invalid numeric state, recognized shortcut keys and an unrelated key. Development preview checks verified the 200% menu action, repeated Command-equals to reach 200%, Command-zero reset, Command-minus to reach 75%, and disabled menu actions at both bounds. Closing and reopening the dashboard restored its default size.

All five empty-data views were inspected at 200% in the 800-by-550-point window during this follow-up. Navigation changes to a horizontal bottom bar; Right and Enter activated Tokens. Long content remained vertically scrollable, including expanded token-counting details. These are page-zoom checks, not a font-only setting or a complete keyboard/screen-reader audit.

The light-theme spot check exposed stale header-button backgrounds during color transitions. Those controls now update immediately. The final candidate was checked again at 200% in light mode, with readable reload and theme icons. The counting explanation and collection guidance were also updated to describe saved Codex records and desktop collection rather than requiring developer-only commands.

The final candidate passed Mac signature, self-test, bundled-collector, WebKit and lifecycle checks. The shared UI passed TypeScript and both builds on Windows. No new dependencies or installed-app changes were required.

## Populated and keyboard follow-up, candidates `9eba4db` and `ca8c7e7`

Fixed fictional records were loaded into isolated Mac previews with all collectors disabled. All five populated views were inspected. Representative keyboard-only paths covered Activity week bands and day navigation, Tokens periods/hosts/model details, nested Agents disclosures, Dictation provider/device/history choices and Sources privacy guidance. Tab, Shift-Tab, arrow keys where supported and Enter operated these paths with visible focus.

These checks exposed stale selected-button backgrounds in the period and dictation controls even though data and accessibility states updated. Their inherited transitions are now disabled, without changing counting logic or the underlying controls. Rebuilt Mac previews verified Day/Week/All time and all three dictation selection groups in both directions, with matching highlights and totals. Typechecking, both web builds, native checks and hosted CI passed.

The `ca8c7e7` Mac ZIP includes these fixes and passed extraction plus relocated runtime/lifecycle checks. The matching Windows package passed all 997 payload hashes, and its separate installer test identity passed the installation suite. A signed-in Windows synthetic smoke test verified dashboard initialization and local snapshot fetch; the Activity capture was visually inspected. This is one configured machine, not clean-machine compatibility or full Windows interaction coverage.

## Still open

- Complete every-control focus-order and screen-reader review, including populated views in both themes and enlarged layouts. The representative keyboard paths above are not an exhaustive accessibility audit.
- Repeat the interaction and layout checks in Windows WebView2. A Windows web build does not prove Windows-native interaction behavior.
- Complete the remaining release checks on the installed build 29 and any later candidate. Documentation-only commits do not change an embedded artifact revision or require relabeling it.

## Mac disconnect failure and retry

A later isolated development-preview check used only a synthetic sentinel and no configured sources. An unsafe private-directory permission fixture caused the native disconnect action to fail. The visible alert explained that collection was paused and offered retry guidance. The saved sentinel stayed unchanged, no revocation marker was created, and a manual source refresh left the collector snapshot unchanged.

After correcting only the fixture permissions, retry displayed the success alert, created the revocation marker, preserved the sentinel and resumed local collection. Both result dialogs were inspected visually and through accessibility text. Quitting the preview removed its temporary data. No installed app or Windows state was changed. This does not cover every failure cause, Windows dialogs or full screen-reader navigation.

See the [release checklist](RELEASE-CHECKLIST.md) for the remaining installation, lifecycle, security and publication gates.
