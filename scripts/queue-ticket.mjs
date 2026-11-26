// Files a self-check ticket as a new row in a Markdown work queue: a table whose first column is the row number.
// The row goes at the end of the table holding the highest number, numbered one past it. A ticket whose marker
// is already in a row that is not done is not filed again.
// Run it as a program inside the queue's own lock: node scripts/queue-ticket.mjs <queue.md> <ticket JSON> [--commit]
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROW=/^\|\s*(\d+)\s*\|/;
const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim());
// A cell holds no pipe or line break of its own.
// Every cell is capped, so a ticket can never be more than a short row.
const MAX_CELL=400;
// oxlint-disable-next-line no-control-regex -- removing control characters is the point
const flat=text=>String(text ?? '').replace(/[|\r\n]+/g,' ').replace(/[\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().slice(0,MAX_CELL);

export const marker=key=>`[observatory-check ${String(key).replace(/[^A-Za-z0-9/-]/g,'').slice(0,60)}]`;

/** The queue text with the ticket's row added, or the row that already holds it. */
export function withTicket(text,ticket,{engine='agent'}={}) {
  const lines=text.split('\n');
  const mark=marker(ticket.key);
  let highest=-1,at=-1;
  for(const [index,line] of lines.entries()) {
    const found=ROW.exec(line);
    if(!found)continue;
    const row=cells(line);
    if(line.includes(mark) && !/^(done|dropped)\b/i.test(row.at(-1) ?? ''))return {result:'open',row:Number(found[1]),text};
    if(Number(found[1])>highest) {highest=Number(found[1]);at=index;}
  }
  if(at===-1)throw Error('No numbered queue table');
  // The table's header names the columns. Unknown columns stay empty.
  let header=at;
  while(header>0 && lines[header-1].trim().startsWith('|'))header--;
  const names=cells(lines[header]).map(name=>name.toLowerCase());
  let end=at;
  while(end+1<lines.length && lines[end+1].trim().startsWith('|'))end++;
  const number=highest+1;
  const values={'#':String(number),job:`${flat(ticket.job)} ${mark}`,engine:flat(engine),'done when':flat(ticket.doneWhen),status:'ready'};
  lines.splice(end+1,0,`| ${names.map(name=>values[name] ?? '').join(' | ')} |`);
  return {result:'filed',row:number,text:lines.join('\n')};
}

export function fileTicketIn(file,ticket,{engine,commit=false}={}) {
  const before=fs.readFileSync(file,'utf8');
  const outcome=withTicket(before,ticket,{engine});
  if(outcome.result!=='filed')return {result:outcome.result,row:outcome.row};
  const temp=`${file}.observatory-${process.pid}.tmp`;
  fs.writeFileSync(temp,outcome.text,{mode:fs.statSync(file).mode & 0o777});
  fs.renameSync(temp,file);
  if(commit) {
    const folder=path.dirname(file),name=path.basename(file);
    execFileSync('git',['-C',folder,'add','--',name],{stdio:'ignore'});
    execFileSync('git',['-C',folder,'commit','-q','--only','-m',`queue: self-check row ${outcome.row}, ${flat(ticket.label)} on ${flat(ticket.machine)}`,'--',name],{stdio:'ignore'});
  }
  return {result:'filed',row:outcome.row};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [file,payload,...flags]=process.argv.slice(2);
  try {
    const {ticket,engine}=JSON.parse(payload);
    console.log(JSON.stringify(fileTicketIn(file,ticket,{engine,commit:flags.includes('--commit')})));
  } catch(error) {
    console.log(JSON.stringify({result:'failed',error:error.message}));
    process.exitCode=1;
  }
}
