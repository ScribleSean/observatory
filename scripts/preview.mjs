// Serve the dashboard with fictional data, for working on the pages.
// Writes nothing outside a temporary folder.
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLocalServer} from '../serve-local.mjs';
import {combine} from '../lib/combine.mjs';
import {ownSnapshot} from '../test/helpers.mjs';

const now=Date.now();
const dataFolder=await mkdtemp(path.join(tmpdir(),'observatory-preview-'));
await mkdir(path.join(dataFolder,'public','local'),{recursive:true});
const combined=combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)},{host:'Windows',snapshot:ownSnapshot('Windows',now-20*60000)}],{now,generatedBy:'Mac'});
await writeFile(path.join(dataFolder,'public','local','combined.json'),JSON.stringify(combined));
const port=Number(process.env.PORT || 5602);
createLocalServer({dataFolder}).listen(port,'127.0.0.1',()=>console.log(`Fictional preview: http://127.0.0.1:${port}`));
