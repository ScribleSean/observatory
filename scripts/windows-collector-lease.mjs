// A native app owns the sole writer. The Node entrypoint owns this read end.
// Dispose after collection so a successful operation cannot keep Node alive.
export function windowsCollectorLease(input,{timeoutMs=2000}={}) {
  const controller=new AbortController();
  let resolveReady,received=false,disposed=false;
  const ready=new Promise(resolve=>{resolveReady=resolve;});
  const abort=()=>{clearTimeout(timer);controller.abort();resolveReady(false);};
  const data=bytes=>{
    if(received || bytes.length!==1 || bytes[0]!==1){abort();return;}
    received=true;clearTimeout(timer);resolveReady(true);
  };
  const timer=setTimeout(abort,timeoutMs);
  input.on('data',data);input.once('end',abort);input.once('close',abort);input.once('error',abort);
  input.resume();
  return {ready,signal:controller.signal,dispose(){
    if(disposed)return;disposed=true;clearTimeout(timer);
    input.removeListener('data',data);input.removeListener('end',abort);input.removeListener('close',abort);input.removeListener('error',abort);
    controller.abort();resolveReady(false);input.destroy();
  }};
}
