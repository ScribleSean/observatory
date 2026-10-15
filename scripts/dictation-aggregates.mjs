const engines = new Set(['Apple Speech','Parakeet / sherpa-onnx','WhisperKit','Whisper.cpp','Unknown']);
const statuses = new Set(['ok','not-found','not-connected','unavailable','ambiguous']);
const count = value => Number.isSafeInteger(value) && value >= 0;
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;

export function cleanDictation(raw, host) {
  if (!['Mac','Windows'].includes(host) || !statuses.has(raw?.status)) throw Error('Invalid dictation source');
  if (raw.status !== 'ok') return {host,status:raw.status};
  if (!Array.isArray(raw.days) || raw.days.length > 36600) throw Error('Invalid dictation days');
  const days = raw.days.map(row => {
    if (!date(row.date) || !count(row.transcriptions) || !count(row.words) || !amount(row.audioSeconds) || !Array.isArray(row.engines)) throw Error('Invalid dictation aggregate');
    const models = row.engines.map(item => {
      if (!engines.has(item.engine) || !count(item.transcriptions)) throw Error('Invalid dictation engine');
      return {engine:item.engine,transcriptions:item.transcriptions};
    });
    if (new Set(models.map(m=>m.engine)).size !== models.length || models.reduce((n,m)=>n+m.transcriptions,0)>row.transcriptions) throw Error('Invalid engine total');
    return {date:row.date,transcriptions:row.transcriptions,words:row.words,audioSeconds:row.audioSeconds,engines:models};
  }).sort((a,b)=>a.date.localeCompare(b.date));
  if (new Set(days.map(d=>d.date)).size !== days.length) throw Error('Duplicate dictation days');
  return {host,status:'ok',calendar:'device-local',scope:'retained-transcriptions',days};
}

export function summarizeDictation(source, startDate, endDate) {
  if (source?.status !== 'ok') return null;
  const days = source.days.filter(d=>(!startDate || d.date>=startDate) && (!endDate || d.date<=endDate));
  if (!days.length) return null;
  const totals = {transcriptions:0,words:0,audioSeconds:0,recordedDays:days.length,engines:[]};
  const modelCounts = new Map();
  for (const day of days) {
    for (const key of ['transcriptions','words','audioSeconds']) totals[key] += day[key];
    for (const model of day.engines) modelCounts.set(model.engine,(modelCounts.get(model.engine)||0)+model.transcriptions);
  }
  totals.engines = [...modelCounts].map(([engine,transcriptions])=>({engine,transcriptions})).sort((a,b)=>b.transcriptions-a.transcriptions);
  return totals;
}
