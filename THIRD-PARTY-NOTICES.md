# Third-party software

This project was scaffolded with OpenAI Sites and uses React, Vinext and the dependencies declared in package.json. Their respective licenses remain applicable. Inspect the installed packages for full notices.

The generated components/ui source is derived from shadcn/ui (MIT), Copyright (c) 2023 shadcn. The MIT permission and disclaimer text in LICENSE also applies to that component source with this original attribution retained.

ActivityWatch and ccusage are independent external tools. They are not bundled, re-licensed or represented as this project's original work.

Inter Tight is bundled from the Google Fonts repository under the SIL Open Font License 1.1. Its complete copyright and license text is retained in `public/fonts/OFL.txt`, copied into Mac Resources and included in generated web notices. The app makes no font-service requests.

## Native package notices

Mac candidates include Node and the Astral python-build-standalone distribution of CPython. Versions and archive checksums are pinned in `native/mac/runtime-assets.json`. Their original notices, Python dependency notices, and the generated web notices live inside the app's Resources directory. See [Mac packaging](docs/MAC.md) for the documented system-zlib manifest exception. The app does not replace system runtimes.

The native dashboard build generates `assets/third-party-licenses.txt` from JavaScript packages present in the emitted chunks and the explicitly imported CSS packages. A required package without a license file fails the build. Source checkout paths are not included in the generated notice.

Windows package candidates include private copies of Node, Python with timezone data, and the .NET desktop runtime. Their versions and download checksums are pinned in `native/windows/runtime-assets.json` and the Windows project file. These copies do not replace system installations.

The Windows package recipe also includes the pinned WinSparkle x64 updater DLL.
Its distribution and runtime checksums are recorded in
`native/windows/updater-tool.json`. The original WinSparkle and Expat notices
are included beside the DLL as `Updater/COPYING` and `Updater/COPYING.expat`.

The package's `Licenses` directory contains the Node and Python distribution notices, timezone-data license files, .NET notices, WebView2 SDK license and notice, and generated dashboard notices. Original notices inside the Python distribution are also retained. The installed Microsoft Edge WebView2 Runtime is a separate system prerequisite and is not bundled by this packaging script.

Python uses the official [embeddable distribution](https://docs.python.org/3/using/windows.html#the-embeddable-package), with timezone data vendored alongside it. No pip installation or package download occurs when the application collects records.
