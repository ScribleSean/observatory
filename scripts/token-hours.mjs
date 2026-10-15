export function stripTokenHours(row) {
  return {...row,...(Array.isArray(row?.days)?{days:row.days.map(day=>{
    if(!day || typeof day!=='object')return day;
    const {hours:_hours,...safe}=day;return safe;
  })}:{})};
}

export function attachTokenHours(tokensRow,hourTotals) {
  if(tokensRow.status!=='ok')return tokensRow;
  const entries=new Map(),duplicates=new Set();
  for(const entry of Array.isArray(hourTotals)?hourTotals:[]) {
    if(!entry || typeof entry.date!=='string')continue;
    if(entries.has(entry.date))duplicates.add(entry.date);
    entries.set(entry.date,entry.hours);
  }
  const row=stripTokenHours(tokensRow);
  return {...row,days:row.days.map(day=>{
    const hours=entries.get(day.date);
    if(duplicates.has(day.date) || !Array.isArray(hours) || hours.length!==24 || !Number.isSafeInteger(day.totalTokens) ||
      !Array.from(hours).every(value=>Number.isSafeInteger(value) && value>=0) ||
      hours.reduce((sum,value)=>sum+value,0)!==day.totalTokens)return day;
    return {...day,hours:[...hours]};
  })};
}
