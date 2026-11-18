// Serves the dashboard with the fictional round 2 fixture (lib/sample-r2.mjs): three computers with a daily ledger
// history, limits with a stored forecast, screen time and one saved view. Nothing here reads this computer's data.
// PREVIEW_OUT=<file> writes the fictional combined.json and exits. PORT picks the port (5602 by default).
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLocalServer} from '../serve-local.mjs';
import {sampleR2Combined} from '../lib/sample-r2.mjs';
import {saveView} from '../lib/saved-views.mjs';

const now=Date.now();
const combined=sampleR2Combined(now);
if(process.env.PREVIEW_OUT) {
  await writeFile(process.env.PREVIEW_OUT,JSON.stringify(combined));
  console.log(`Fictional combined.json written to ${process.env.PREVIEW_OUT}`);
  process.exit(0);
}
const dataFolder=await mkdtemp(path.join(tmpdir(),'observatory-preview-'));
await mkdir(path.join(dataFolder,'public','local'),{recursive:true});
await writeFile(path.join(dataFolder,'public','local','combined.json'),JSON.stringify(combined));
// One view as the MCP server would save it (docs/MCP.md), so the saved views list has something to draw.
const saved=await saveView(dataFolder,{id:'spend-by-repo',title:'Spend by repository',question:'Where did this week go?',spec:{root:'page',elements:{
  page:{type:'Section',props:{title:'This week by repository',columns:6},children:['spend','repos']},
  spend:{type:'Headline',props:{metric:'spend',breakdowns:['repo','model'],scope:{range:{unit:'week'}}}},
  repos:{type:'Breakdown',props:{metric:'spend',dim:'repo',limit:6,scope:{range:{unit:'week'}}}}}}},{now});
if(!saved.ok)throw Error(`The sample saved view was refused: ${saved.errors.join(', ')}`);
const port=Number(process.env.PORT || 5602);
createLocalServer({dataFolder}).listen(port,'127.0.0.1',()=>console.log(`Fictional preview: http://127.0.0.1:${port}`));
