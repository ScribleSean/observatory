// Small pure helpers shared by the adapters and the snapshot checks, with no file access.

// The fixed tool categories scripts/read-settings.mjs uses for Codex tools.
export const TOOL_CATEGORIES=Object.freeze(['Shell','File edits','Browser','Research','Other tools']);

// A tool's own session title, kept on the user's computers only. Control characters are dropped.
export function cleanTitle(value) {
  if(typeof value!=='string')return null;
  // oxlint-disable-next-line no-control-regex -- dropping control characters is the point
  const text=value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  return text?text.slice(0,120):null;
}
