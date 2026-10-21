import { useMemo } from 'react';
import { skinCss, validateSkin } from '../../lib/skins.mjs';
import sage from './sage.json';

// One bundled skin. Skins as data files may come back later.
export const SKINS: Record<string, unknown> = { sage };

export function useSkin(_initialSkin = 'sage') {
  const skin = useMemo(() => validateSkin(SKINS.sage), []);
  const css = useMemo(() => skinCss(skin), [skin]);
  const className = `ob-font-${skin.font}${skin.rules ? ' ob-rules' : ''}`;
  return { skinId: 'sage', skin, css, className };
}
