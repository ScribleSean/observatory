# Intro storyboard

A short product intro for Observatory, 27 seconds in seven beats. It follows the three questions the app answers, ends on the install command, and uses only fictional data. It is written to hand to a motion tool or an editor as is.

## Ground rules

- **Length:** 27 seconds. Each beat lists its start time and length. Trim beats 3 to 5 evenly to reach 24 seconds, or hold each a little longer to reach 32.
- **Formats:** 1920 by 1080 for the README and portfolio, and 1080 by 1350 for social posts. Keep text inside the middle 80 percent.
- **Look:** the Sage skin. Light background `#EDEAE5`, surface `#F4F1EC`, text `#292D28`, accent `#586F50`. Series colours are Claude Code `#B5633C` and Codex `#2E6E9E`. Beat 6 switches to dark mode: background `#1C1D1B`, surface `#272825`.
- **Type:** Inter Tight, the font the dashboard uses (in `public/fonts`). On-screen text is sentence case, one line, at most seven words.
- **Motion:** calm. Ease-out cubic, 400 to 600 ms moves, no bounce and no spins. Numbers count up over 600 ms. One idea moves at a time. Cuts happen on a number landing.
- **Sound:** a soft ambient bed. No voice-over is needed, so the text carries the story.
- **Data:** fictional only. Record the screens from `npm run preview` (two computers) and `PREVIEW_ONE=1 npm run preview` (one computer). The still frames in `docs/images` match those states.

## Beats

| # | Time | Length | Shows | On-screen text | Motion and pacing |
| --- | --- | --- | --- | --- | --- |
| 1 | 0.0 | 3.0 s | A quiet Mac menu bar on the Sage background. The telescope fades in with `47%` beside it. | Your limits, at a glance. | Hold still for 0.5 s, then fade the item in over 600 ms. The text rises 8 px as it fades in. |
| 2 | 3.0 | 4.0 s | The menu opens under the item: Limits and Today sections. | Observatory lives in your menu bar. | The menu drops 12 px as it fades in. Rows appear top to bottom, 60 ms apart. |
| 3 | 7.0 | 4.5 s | Cut to the dashboard. Push in on the Limits tile: `47%` counts up and the four bars fill. | Am I near my limits? | Bars fill left to right, 80 ms apart. The hero number lands at 8.0 s. Hold for 1 s. |
| 4 | 11.5 | 4.0 s | The Screen time tile: `3h 53m` counts up, with Editors and Browser below. | Where did my time go? | The number counts up. The two rows slide in 80 ms apart. |
| 5 | 15.5 | 4.0 s | The Cost tile: `$60.70` counts up, with Claude Code and Codex rows and their coloured dots. | What did it cost? | The same treatment as beat 4, so the rhythm repeats. Hold on the caption "API-equivalent estimate, not a bill". |
| 6 | 19.5 | 4.5 s | Pull back to the whole dashboard, cross into dark mode, then a second computer chip ("Test PC") slides into the header and the tiles show both computers. | One computer, or two. | Pull back over 700 ms. Crossfade light to dark over 500 ms. The chip slides 16 px from the right. |
| 7 | 24.0 | 3.0 s | End card on the background: the telescope mark, the name, and the install line in a code style. | `git clone`, then `npm run setup`. Local only. Open source. | The mark and the name fade in first, the command 300 ms later. Hold to the end. |

## Notes for the editor

- Beat 3 is the heart of the piece. If time is cut, keep it at full length.
- In beat 6 the second computer is optional. Keep the cut short so it reads as an add-on, not a requirement.
- The end card text follows the README. Do not add claims that are not in it, such as speed or savings figures.
- Show no real names, projects or numbers. The preview data uses the project names portfolio, observatory, field-notes, dotfiles, recipes and tray-app. Use the same names throughout the video.
- Captions: the on-screen text in each beat doubles as the captions. Add no other subtitles.
