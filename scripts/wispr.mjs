import {cleanDictation, summarizeDictation} from './dictation-aggregates.mjs';

export function cleanWispr(raw, host) {
  const safe = cleanDictation(raw, host);
  if (safe.status === 'ok') {
    const original = new Map(raw.days.map(day => [day.date, day]));
    safe.days = safe.days.map(day => {
      const coverage = original.get(day.date);
      for (const key of ['wordRecords','audioRecords']) {
        if (!Number.isSafeInteger(coverage[key]) || coverage[key] < 0 || coverage[key] > day.transcriptions) throw Error('Invalid Wispr coverage');
      }
      if ((!coverage.wordRecords && day.words) || (!coverage.audioRecords && day.audioSeconds)) throw Error('Invalid uncovered totals');
      return {...day, engines:[], wordRecords:coverage.wordRecords, audioRecords:coverage.audioRecords};
    });
  }
  return {...safe, source:'Wispr Flow', calendar:'America/New_York', scope:'retained-history-records'};
}

export function summarizeWispr(source, start, end) {
  const totals = summarizeDictation(source, start, end);
  if (!totals) return null;
  const days = source.days.filter(day => (!start || day.date >= start) && (!end || day.date <= end));
  return {...totals, wordRecords:days.reduce((n,day)=>n+day.wordRecords,0), audioRecords:days.reduce((n,day)=>n+day.audioRecords,0)};
}
