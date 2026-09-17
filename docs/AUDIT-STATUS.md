# September 15 audit follow-up

Reviewed September 17 against source `18e44a6b`, the original repair report and subsequent development records. The [audit reports in PR #1](https://github.com/ScribleSean/observatory/pull/1) predate substantial repairs committed directly to main. The report-only PR is not a pending implementation patch.

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

The September 15 live addendum originally observed older installed applications. Its absence-of-Agents and unconditional dictation-Unknown findings must not be treated as current source defects. Subsequent build-24 installation evidence is recorded in the [release notes](RELEASE-0.3.13.md).

## Decisions and remaining acceptance

- Allowances as the landing view is an explicit retained product choice. Opening Allowances is not itself a defect.
- The local-speech coming-soon sentence was explicitly requested by the product owner. Its presence is not an unresolved audit defect. Verified support and missing-data labels still matter.
- Native Agents placement is repaired. The web demo still places execution details under Sources. That separate consistency criterion remains to be reconciled with the web demo's supported scope.
- ChatGPT voice tracking was requested by the product owner and remains unverified. Its selectable filter does not establish implemented tracking. The audit's control treatment and the requested data source remain separate from the requested future-speech sentence.
- Current source still places the development footer on every native Mac section and hardcodes `includeUbuntu: false` in Mac direct-pairing join. These lower-priority findings have not been established as resolved.
- Item 14 now shows an explanatory alert before a foreground Mac launch exits under the installation gate. Background launch remains quiet, and collection is still blocked. Full Mac compilation, native self-tests including synthetic lock cases, and all four installation-gate checks pass. The actual alert interaction and a packaged installation of this change remain unverified.
- Full installed failure/recovery interaction, native accessibility, and every-page visual acceptance are not proven by source compilation or synthetic screenshots alone. Earlier reports explicitly retained those limits.

This reconciliation does not claim that all 19 original acceptance criteria are complete. Keep the audit open until the remaining criteria are resolved or explicitly accepted. Do not redo the completed first slice. Production signing, update feeds and clean-machine release work remain separate [release requirements](RELEASE-CHECKLIST.md).
