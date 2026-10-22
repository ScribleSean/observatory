import http from 'node:http';
import {readFile,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {allowedLocalRequest} from './scripts/request-policy.mjs';
import {loadConfig,localFolder} from './lib/config.mjs';

const types={
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json',
  '.svg':'image/svg+xml',
  '.ttf':'font/ttf',
};
const here=path.dirname(fileURLToPath(import.meta.url));

export function createLocalServer({assets=path.join(here,'dist/dashboard'),dataFolder}) {
  return http.createServer(async(req,res)=>{
    const port=req.socket.localPort;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    if(!allowedLocalRequest(req,port)) {res.writeHead(403);return res.end('Forbidden');}
    if(!['GET','HEAD'].includes(req.method)) {res.writeHead(405);return res.end();}
    try {
      const url=new URL(req.url,`http://127.0.0.1:${port}`);
      let file;
      if(url.pathname==='/local/combined.json') {
        file=path.join(await realpath(localFolder({dataFolder})),'combined.json');
        if(await realpath(file)!==file)throw Error('Linked data path');
      } else {
        const requested=decodeURIComponent(url.pathname);
        const entry=requested==='/' || requested==='/index.html';
        if((!entry && !requested.startsWith('/assets/')) || requested.includes('\\') || requested.split('/').includes('..') ||
          path.extname(requested)==='.json')throw Error('Unavailable route');
        const root=await realpath(assets);
        const target=path.join(root,entry?'index.html':requested);
        file=await realpath(target);
        if(file!==target || !file.startsWith(root+path.sep))throw Error('Linked or unavailable path');
      }
      const mime=types[path.extname(file)];
      if(!mime)throw Error('Unknown type');
      const info=await lstat(file);
      if(!info.isFile() || info.size>16_000_000)throw Error('Not a file');
      const data=await readFile(file);
      res.setHeader('Content-Type',mime);
      res.writeHead(200);
      res.end(req.method==='HEAD'?undefined:data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
}

// With --with-parent the server lives only as long as the app that started it.
// It checks every few seconds and exits once that app has gone, however it ended.
// On macOS an orphan is handed to launchd, so its parent id changes. On Windows
// the parent id stays, so the check also asks whether that process still exists.
export function watchParent(parent,{intervalMs=2000,exit=()=>process.exit(0),currentParent=()=>process.ppid}={}) {
  const alive=pid=>{try {process.kill(pid,0);return true;}catch(error) {return error.code==='EPERM';}};
  // On macOS a parent id of 1 means the app was already gone when the server started.
  const gone=()=>(process.platform!=='win32' && parent===1) || currentParent()!==parent || !alive(parent);
  if(gone()) {exit();return ()=>{};}
  const timer=setInterval(()=>{if(gone())exit();},intervalMs);
  timer.unref();
  return ()=>clearInterval(timer);
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.includes('--with-parent'))watchParent(process.ppid,{intervalMs:Number(process.env.OBSERVATORY_PARENT_CHECK_MS) || 2000});
  const config=await loadConfig();
  const port=config.dashboard.port;
  createLocalServer({dataFolder:config.dataFolder}).listen(port,'127.0.0.1',()=>console.log(`Observatory dashboard: http://127.0.0.1:${port}`))
    .on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use.`:error.message);process.exitCode=1;});
}
