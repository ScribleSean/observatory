export function antigravityPoolLabel(_id,index=0) {
  return `Allowance ${index+1}`;
}

export function antigravityAllowanceDisplay(source,now=Date.now()) {
  const checked=Date.parse(source?.checkedAt),age=now-checked;
  const known=source?.provider==='antigravity' && ['Mac','Windows'].includes(source.host);
  const state=known?source.status:'not-connected';
  const stale=state==='ok' && (!Number.isFinite(age) || age<0 || age>=600000);
  const status=state==='ok'?(stale?'Saved reading':'Latest reading'):state==='not-connected'?'Collection off':'Unknown';
  const guidance=state==='not-connected'?'Enable Antigravity allowance monitoring in native Settings.':
    state==='unsupported'?(source?.host==='Windows'?'Antigravity allowance reading is currently supported on Mac.':'The installed Antigravity CLI returned an unsupported format.'):
    state!=='ok'?'Open the installed Antigravity CLI to check its sign-in, then refresh sources.':
    stale?'This saved reading is not current. Refresh sources for current limits.':'Checks run with full source collection, normally every five minutes.';
  const windows=known && state==='ok' && Array.isArray(source.windows)?source.windows.flatMap((window,index)=>{
    const reset=Date.parse(window?.resetsAt),durationMinutes=window?.window==='5h'?300:window?.window==='weekly'?10080:null;
    if(typeof window?.bucket!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(window.bucket) ||
      durationMinutes===null || typeof window.remainingPercent!=='number' || !Number.isFinite(window.remainingPercent) ||
      window.remainingPercent<0 || window.remainingPercent>100 || !Number.isFinite(reset))return [];
    return [{bucket:window.bucket,window:window.window,remainingPercent:window.remainingPercent,resetsAt:window.resetsAt,
      pool:antigravityPoolLabel(window.bucket,index),label:window.window==='5h'?'5-hour window':'Weekly window',
      resetReached:reset<=now,stale}];
  }).slice(0,32):[];
  return {status,guidance,checkedAt:Number.isFinite(checked)?new Date(checked).toISOString():null,windows};
}
