import { useEffect, useMemo, useState } from 'react';
import { skinCss, validateSkin } from '../../lib/skins.mjs';
import sage from '../../native/skins/sage.json';
import almanac from '../../native/skins/almanac.json';
import instrument from '../../native/skins/instrument.json';
import amberCrt from '../../native/skins/amber-crt.json';

// Bundled skins. A person's own skin files will arrive through the shell later.
export const SKINS: Record<string, unknown> = { sage, almanac, instrument, 'amber-crt': amberCrt };

function isSkinId(id: unknown): id is string {
  return typeof id === 'string' && Object.hasOwn(SKINS, id);
}

export function skinIdFromAttribute(value: unknown): string {
  return isSkinId(value) ? value : 'sage';
}

export function skinIdFrom(search: string, root: { dataset: { skin?: string } } | null): string {
  const query = new URLSearchParams(search).get('skin');
  if (isSkinId(query)) return query;
  return skinIdFromAttribute(root?.dataset.skin);
}

export function useSkin(initialSkin: string) {
  const [activeId, setSkinId] = useState(() => isSkinId(initialSkin) ? initialSkin : 'sage');
  const skinId = isSkinId(activeId) ? activeId : 'sage';
  const skin = useMemo(() => validateSkin(SKINS[skinId]), [skinId]);
  const css = useMemo(() => skinCss(skin), [skin]);
  const className = `ob-font-${skin.font}${skin.rules ? ' ob-rules' : ''}`;

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setSkinId(skinIdFromAttribute(root.dataset.skin));
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-skin'] });
    return () => observer.disconnect();
  }, []);

  return { skinId, setSkinId, skin, css, className };
}
