// The fixed codes a refused source row may carry. New codes are added to the
// design direction first. Kept apart from peer-directory.mjs so modules that
// only read the list do not load the private-folder checks.
export const REFUSAL_CODES=Object.freeze(['private-folder-refused','ancestor-refused']);
