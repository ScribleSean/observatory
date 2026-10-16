import {SKINS, useSkin} from '../skin';
import {validateSkin} from '../../../lib/skins.mjs';

const COPY = {
  "sampleNavigation": "Sample pages",
  "title": "Observatory",
  "lead": "A Mac menu-bar and Windows tray app that shows your Claude Code and Codex limits, your token usage and your screen time. It runs on your computer, has no account and makes no model requests.",
  "sampleHeading": "Try the sample",
  "sampleDescription": "Both pages below use fictional sample data. Nothing is read from your computer.",
  "dashboardLink": "Open the dashboard",
  "panelLink": "Open the panel",
  "skinLabel": "Skin",
  "showsHeading": "What it shows",
  "limits": "How much of each coding limit is left, when it resets and how fast it is being used.",
  "tokens": "Recorded tokens by day and model, with an estimate of what the same tokens would cost at public API prices. The estimate is not a bill.",
  "activity": "Screen time by app category, from ActivityWatch.",
  "dictation": "Optional dictation statistics from Wispr Flow.",
  "paired": "A combined view of a paired Mac and Windows PC, shown only when no session is counted twice.",
  "unknown": "Unknown means a value was not read. It never means zero.",
  "platformsHeading": "Two platforms",
  "mac": "Mac: a menu-bar app for macOS 14 or later on Apple Silicon.",
  "windows": "Windows: a tray app for Windows x64.",
  "sameViewer": "Both show this same viewer.",
  "unsignedHeading": "Unsigned builds",
  "unsignedDescription": "Observatory builds are not signed by an identified developer, so macOS and Windows may show a security warning before the app first opens. There is no installer download yet. You build the app from source with the install guide for your platform.",
  "installHeading": "Install",
  "macGuide": "Mac install guide",
  "windowsGuide": "Windows install guide",
  "source": "Source code",
  "footer": "Fictional sample data only. MIT license."
};

export default function Product({initialSkin = 'sage'}: {initialSkin?: string}) {
  const {skinId, setSkinId, css, className} = useSkin(initialSkin);
  const query = skinId === 'sage' ? '' : `?skin=${encodeURIComponent(skinId)}`;
  return <main className={`ob-product ${className}`}>
    <style>{css}</style>
    <header>
      <h1>{COPY.title}</h1>
      <p>{COPY.lead}</p>
    </header>
    <section aria-labelledby="sample-heading">
      <h2 id="sample-heading">{COPY.sampleHeading}</h2>
      <p>{COPY.sampleDescription}</p>
      <nav aria-label={COPY.sampleNavigation}><a href={`./${query}`}>{COPY.dashboardLink}</a><a href={`./panel.html${query}`}>{COPY.panelLink}</a></nav>
      <label className="ob-product-skin">{COPY.skinLabel} <select value={skinId} onChange={event => setSkinId(event.target.value)}>
        {Object.keys(SKINS).map(id => <option key={id} value={id}>{validateSkin(SKINS[id]).name}</option>)}
      </select></label>
    </section>
    <section aria-labelledby="shows-heading">
      <h2 id="shows-heading">{COPY.showsHeading}</h2>
      <ul>
        <li>{COPY.limits}</li>
        <li>{COPY.tokens}</li>
        <li>{COPY.activity}</li>
        <li>{COPY.dictation}</li>
        <li>{COPY.paired}</li>
        <li>{COPY.unknown}</li>
      </ul>
    </section>
    <section aria-labelledby="platforms-heading">
      <h2 id="platforms-heading">{COPY.platformsHeading}</h2>
      <p>{COPY.mac}</p>
      <p>{COPY.windows}</p>
      <p>{COPY.sameViewer}</p>
    </section>
    <section aria-labelledby="unsigned-heading">
      <h2 id="unsigned-heading">{COPY.unsignedHeading}</h2>
      <p>{COPY.unsignedDescription}</p>
    </section>
    <section aria-labelledby="install-heading">
      <h2 id="install-heading">{COPY.installHeading}</h2>
      <ul>
        <li><a href="https://github.com/ScribleSean/observatory/blob/main/docs/MAC.md">{COPY.macGuide}</a></li>
        <li><a href="https://github.com/ScribleSean/observatory/blob/main/docs/WINDOWS.md">{COPY.windowsGuide}</a></li>
        <li><a href="https://github.com/ScribleSean/observatory">{COPY.source}</a></li>
      </ul>
    </section>
    <footer>{COPY.footer}</footer>
  </main>;
}
