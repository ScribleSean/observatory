// Builds the public web demo: the normal dashboard build with fictional data beside it.
// Run `npm run build` first. Output: dist/demo, served from any subpath.
import {cp,mkdir,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {hostname,userInfo} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FICTIONAL_DEVICES=['Studio Mac','Desk PC'];
const ALLOWED_FILE=/^(index\.html|local\/combined\.json|assets\/[\w-]+\.(js|css|ttf))$/;

// Anything that would point at a real machine or person.
function forbidden() {
  const words=[/\/Users\//,/\/home\//,/[A-Za-z]:\\\\/,/file:\/\//,/\blocalhost\b/,/127\.0\.0\.1/,/[\w.+-]+@[\w-]+\.[\w.]+/];
  const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const own=[hostname().split('.')[0],userInfo().username].filter(word=>word.length>=4 && !/^(runner|root)$/.test(word));
  return [...words,...own.map(word=>new RegExp(`\\b${escape(word)}\\b`,'i'))];
}

export async function checkDemo(dir,{patterns=forbidden()}={}) {
  const problems=[];
  const files=(await readdir(dir,{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile())
    .map(entry=>path.relative(dir,path.join(entry.parentPath,entry.name)).split(path.sep).join('/'));
  for (const file of files) {
    if (!ALLOWED_FILE.test(file)) {problems.push(`unexpected file ${file}`);continue;}
    if (file.endsWith('.ttf')) continue;
    const text=await readFile(path.join(dir,file),'utf8');
    for (const pattern of patterns) if (pattern.test(text)) problems.push(`${file} matches ${pattern}`);
  }
  const html=files.includes('index.html')?await readFile(path.join(dir,'index.html'),'utf8'):'';
  if (!html) problems.push('index.html is missing');
  if (/(src|href)="\//.test(html)) problems.push('index.html uses an absolute path, which breaks under a subpath');
  let data=null;
  try {data=JSON.parse(await readFile(path.join(dir,'local','combined.json'),'utf8'));} catch {problems.push('local/combined.json is missing or not JSON');}
  if (data) {
    if (data.demo!==true) problems.push('local/combined.json lacks the demo marker');
    const names=(data.devices??[]).map(device=>device.name);
    if (JSON.stringify(names)!==JSON.stringify(FICTIONAL_DEVICES)) problems.push(`device names are not the fictional ones: ${names.join(', ')}`);
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const out=path.join(ROOT,'dist','demo');
  await rm(out,{recursive:true,force:true});
  await cp(path.join(ROOT,'dist','dashboard'),out,{recursive:true});
  await mkdir(path.join(out,'local'));
  const file=path.join(out,'local','combined.json');
  execFileSync(process.execPath,[path.join(ROOT,'scripts','preview.mjs')],{env:{...process.env,PREVIEW_OUT:file},stdio:'ignore'});
  await writeFile(file,JSON.stringify({demo:true,...JSON.parse(await readFile(file,'utf8'))}));
  const problems=await checkDemo(out);
  if (problems.length) {console.error(problems.join('\n'));process.exit(1);}
  console.log(`Demo built in ${path.relative(ROOT,out)} with fictional data only.`);
}
