// Token counts from one transcript event, shared by the daily project reader (scripts/read-projects.mjs)
// and the ledger adapters, so both count a request the same way.
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const count=value=>Number.isSafeInteger(value) && value>=0?value:null;
const MODEL=/^[a-z0-9][a-z0-9.-]{0,63}$/;
export const modelName=value=>typeof value==='string' && MODEL.test(value)?value:'unknown';

// Claude Code writes one request several times as it streams, so callers keep the largest total for each
// message id. Returns null for an event that is not a request with usage, 'invalid' when a count is
// unreadable ({invalid, at} when only the counts are), and 'empty' for a placeholder reply (no message id or all zeros).
export function claudeRequest(event) {
  if(event.type!=='assistant' || !object(event.message) || !object(event.message.usage))return null;
  const usage=event.message.usage;
  const at=Date.parse(event.timestamp);
  if(!Number.isFinite(at))return 'invalid';
  const values=['input_tokens','cache_read_input_tokens','cache_creation_input_tokens','output_tokens'].map(key=>count(usage[key]));
  // The time is still given, so a caller can ignore a bad line outside the days it reads.
  if(values.includes(null))return {invalid:true,at};
  if(typeof event.message.id!=='string' || !event.message.id || values.every(value=>value===0))return 'empty';
  return {id:event.message.id,at,model:modelName(event.message.model),values,total:values.reduce((a,b)=>a+b,0)};
}

// Codex: a token_count event's last turn. Codex input includes cache reads and writes, and output
// includes reasoning. Returns the four counts, 'invalid' or 'empty'.
export function codexTurn(last) {
  if(!object(last))return 'invalid';
  const input=count(last.input_tokens),cached=count(last.cached_input_tokens),written=count(last.cache_write_input_tokens ?? 0),output=count(last.output_tokens);
  if([input,cached,written,output].includes(null) || input<cached+written)return 'invalid';
  const values=[input-cached-written,cached,written,output];
  return values.every(value=>value===0)?'empty':values;
}
