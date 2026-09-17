# September 15 audit follow-up

Reviewed September 17 against the installed build-25 source, subsequent popup repairs, the original repair report and development records. The [audit reports in PR #1](https://github.com/ScribleSean/observatory/pull/1) predate substantial repairs committed directly to main. The report-only PR is not a pending implementation patch.

## Completed source repairs

| Audit finding | Repair evidence |
| --- | --- |
| Pairing pause, SSH setup copy, ActivityWatch recovery and compact Settings action | `dbd0a85` implemented all four first-slice repairs. The recorded checks include Swift self-tests, synthetic pause/shutdown, lifecycle and popup routing, Windows compilation, TypeScript and web build. Current source retains these repairs. |
| Native-first guide and honest distribution instructions | `140dad9` made native setup primary. `11071b1` clarified demo/source distribution. `006dd98` documented Allowances as the landing view. |
| Native Refresh versus web Reload | `0d38a21` corrected the collection versus snapshot-reload documentation. |
| Demo overwrite behavior | `2bdddc7` added the clear refusal path and preservation checks. |
| Native Agents navigation and settings routes | `242711c` restored Agents on both native sidebars and removed the Mac redirect to Sources. The current source has the same seven native sections. |
| Dictation headline and visible device settings | `c3d36dd` replaced unconditional Unknown with known selected-period readings by tool and device, without summing overlapping devices. Devices routes to connection settings on both platforms. |
| Windows visual improvements | Later verified work includes sage meters (`886b097`), sidebar icons (`04c1cd2`), light/dark appearance (`3a0be4d`) and unified Agents cards (`af7de22`). These are concrete improvements, not proof that every visual criterion is complete. |

The September 15 live addendum originally observed older installed applications. Its absence-of-Agents and unconditional dictation-Unknown findings must not be treated as current source defects. Subsequent build-24 and build-25 installation evidence is recorded in the [release notes](RELEASE-0.3.13.md).

## Decisions and remaining acceptance

- Allowances as the landing view is an explicit retained product choice. Opening Allowances is not itself a defect.
- The local-speech coming-soon sentence was explicitly requested by the product owner. Its presence is not an unresolved audit defect. Verified support and missing-data labels still matter.
- Agents now has a separate view in the web source, matching the native navigation. Sources retains connection health and coverage. The existing receipt, benchmark and tool components were reused. Browser checks with fictional records verified both views at desktop and narrow widths, and the narrow receipt metric layout was corrected. Hosted deployment and installed web fallback still require the updated bundle.
- ChatGPT voice tracking was requested by the product owner and remains unverified. Its selectable filter does not establish implemented tracking. The audit's control treatment and the requested data source remain separate from the requested future-speech sentence.
- Item 12: the general development notice now appears only in Settings on both native platforms. The separate Sources naming criterion remains to be reviewed. Both platform builds pass.
- Item 13: protocol review confirmed that a joining Mac must request Mac-only scope. The TLS client and join receiver reject Ubuntu scope for a Mac. The UI now disables the host-only Ubuntu choice while joining and explains that Ubuntu scope is chosen on the Windows host. A fake-bridge regression confirms Mac-only joining even after an earlier Ubuntu host selection. Full compilation, native self-tests and the pairing-model test pass. Visual interaction remains unverified.
- Item 14 now shows an explanatory alert before a foreground Mac launch exits under the installation gate. Background launch remains quiet, and collection is still blocked. Full Mac compilation, native self-tests including synthetic lock cases, and all four installation-gate checks pass. The change is included in the verified build-25 installation. The actual blocked-launch alert interaction remains unverified.
- Full installed failure/recovery interaction, native accessibility, and every-page visual acceptance are not proven by source compilation or synthetic screenshots alone. Earlier reports explicitly retained those limits.

Item 16 now gates the Mac compact health indicator on collection being allowed, setup being complete, no pairing pause or shutdown, a current non-future snapshot, and at least one configured source with all reads successful. The status text names blocked collection instead of presenting only saved read counts. Synthetic store checks cover setup, disabled collection, pauses, stale/future timestamps and empty source counts. Native self-tests and shutdown regressions pass. Interactive panel acceptance remains unverified.

Item 15: native Windows tray Configure now calls the same Open path as Open Observatory, then selects Settings in the retained main dashboard. It no longer creates a separate modal native dashboard in the default mode. The explicit legacy-dashboard mode retains its separate settings editor. Windows compilation and the eight audit/installation routing checks pass. The compact popup now explains verified All totals and Ubuntu token-only coverage. Refresh failures show generic recovery guidance, preserve retry availability and do not expose exception details. A native Windows fixture verified failure, successful retry, exclusion of concurrent refreshes, host changes during refresh and on-screen placement. The rendered failure state was inspected. This later popup fix is source-verified but not installed in build 25. Actual tray interaction remains unverified.

This reconciliation does not claim that all 19 original acceptance criteria are complete. Keep the audit open until the remaining criteria are resolved or explicitly accepted. Do not redo the completed first slice. Production signing, update feeds and clean-machine release work remain separate [release requirements](RELEASE-CHECKLIST.md).
