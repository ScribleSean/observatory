# Observatory

The product name is **Observatory**. The repository and package name are `observatory`.

Existing data directories, bundle paths and installation identifiers may retain the former Workspace Observatory name for upgrade compatibility. These are storage and installation details, not the public brand. Do not rename them without a tested migration that preserves saved history and settings.

The canonical mark is [the telescope](../public/brand/telescope.svg). It represents observation rather than control. Use this same silhouette in the menu bar, application icon, dashboard, favicon and documentation. The favicon and native icons are generated from it, not redrawn independently.

Use an earthy space palette with one sage accent family per view. Dark mode uses background `#1c1d1b`, raised surfaces `#272825`, text `#f0eee8`, secondary text `#b3b7ac` and sage `#adc29d`. Light mode uses background `#edeae5`, surfaces `#f4f1ec`, text `#292d28`, secondary text `#64695f` and sage `#586f50`. The default is dark. Both modes must remain readable.

[native/design-tokens.json](../native/design-tokens.json) owns the Mac and Windows palette, type sizes, spacing, card dimensions and shadow strength. Run `node scripts/build-design-tokens.mjs` after changing it. The checked-in Swift and C# constants need no runtime parser, and the theme tests reject stale generated files. Native renderers use their own shadow and text drawing APIs.

Keep the mark monochrome. Leave clear space around it and keep the telescope recognizable at small sizes. Do not add galaxies, glows or decorative animation. Bundle Inter Tight locally with its SIL Open Font License. Titles use 22px type with tight tracking where the native renderer supports it. Section headings use 19px, body labels use 14.5px and secondary labels use 12px. SwiftUI title tracking is -0.7px and section tracking is -0.5px.

Use 12 to 18px card radii and soft layered shadows instead of outlined cards. Icon controls are circular, 38 to 46px. Text controls use the same height with capsule corners. Give controls a soft inset highlight and drop shadow. Dividers use the track token (`#dadbd3` light, `#3b3e37` dark). Use opaque surfaces, no web blur layers or continuous animation. Respect reduced motion. The demo and native Mac dashboard share this system. Data collection and native settings remain functional, not simulated by the demo.

Navigation order is Allowances, Activity, Tokens, Dictation, Agents, Source health, Settings. Agents contains saved receipts, benchmarks and recorded tool calls. Source health contains connection status, collection health and coverage. Make remaining allowance, estimated time coverage to reset and observed hourly pace easy to scan. Missing observations may have a dotted bridge labeled as unknown coverage. Do not invent samples inside gaps or connect across resets.

Keep performance claims measured. App size is not memory use, and a single idle sample is not a sustained benchmark. Missing or stale measurements must remain identifiable.
