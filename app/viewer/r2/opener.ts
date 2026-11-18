// The element that had focus when a session was chosen. It is read before the page behind the panel goes inert,
// because Chrome then moves focus to the body and the panel would have nothing to hand focus back to.
let opener: HTMLElement | null = null;

/** Called as a session is chosen. */
export function rememberOpener() {
  opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
}

/** The remembered opener, once. */
export function takeOpener(): HTMLElement | null {
  const taken = opener;
  opener = null;
  return taken;
}
