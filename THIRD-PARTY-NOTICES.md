# Third-party software

Observatory's own code is under the [MIT license](LICENSE). The pieces below come from others.

## Shipped in the dashboard

`npm run setup` builds the dashboard into `dist/dashboard` on your computer. That build contains:

| Package | License |
| --- | --- |
| [React](https://github.com/facebook/react) and React DOM, with their scheduler | MIT |
| [json-render](https://github.com/vercel-labs/json-render) core and React renderer, 0.22.0 | Apache-2.0 |
| [Zod](https://github.com/colinhacks/zod) 4.6.7 | MIT |
| [Geist and Geist Mono](https://github.com/vercel/geist-font) fonts, from the `@fontsource/geist-sans` and `@fontsource/geist-mono` packages, 5.3.0 | SIL Open Font License 1.1 |

The fonts are copied into the build as woff2 files (Latin, weights 400 to 600 for Geist and 400 and 500 for Geist Mono), so the dashboard loads no font from the network. Their license text is in `node_modules/@fontsource/geist-sans/LICENSE` after `npm install`. Copyright 2023 Vercel, made in collaboration with basement.studio.

## Used only to build and test

Vite, the React plugin for Vite, TypeScript, oxlint and oxfmt run on your computer during setup or development. They are listed in `package.json` with their versions, and none of them ships in the dashboard or the menu bar and tray apps.

## Not bundled

Observatory uses Node.js, ActivityWatch, Claude Code and Codex as they are already installed on your computer. It downloads and bundles none of them. The menu bar app is built with the Swift compiler from Apple's command line tools, and the tray app with the C# compiler that comes with Windows.

The notices for the full app up to build 44, which did bundle runtimes, are in the `archive/full-app` tag.
