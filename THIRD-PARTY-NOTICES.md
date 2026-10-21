# Third-party software

Observatory's own code is under the [MIT license](LICENSE). The pieces below come from others.

## Shipped in the dashboard

`npm run setup` builds the dashboard into `dist/dashboard` on your computer. That build contains:

| Package | License |
| --- | --- |
| [React](https://github.com/facebook/react) and React DOM, with their scheduler | MIT |
| [Inter Tight](https://github.com/googlefonts/inter-tight) | SIL Open Font License 1.1, in `public/fonts/OFL.txt` |
| [Fraunces](https://github.com/undercasetype/Fraunces) | SIL Open Font License 1.1, in `public/fonts/Fraunces-OFL.txt` |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | SIL Open Font License 1.1, in `public/fonts/JetBrainsMono-OFL.txt` |

## Used only to build and test

Vite, the React plugin for Vite, TypeScript, oxlint and oxfmt run on your computer during setup or development. They are listed in `package.json` with their versions, and none of them ships in the dashboard or the menu bar and tray apps.

## Not bundled

Observatory uses Node.js, ActivityWatch, Claude Code and Codex as they are already installed on your computer. It downloads and bundles none of them. The menu bar app is built with the Swift compiler from Apple's command line tools, and the tray app with the C# compiler that comes with Windows.

The notices for the full app up to build 44, which did bundle runtimes, are in the `archive/full-app` tag.
