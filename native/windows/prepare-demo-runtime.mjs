import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {demoData} from '../../scripts/demo.mjs';

const runtime=process.argv[2];
if(!runtime || !path.isAbsolute(runtime))throw Error('A new absolute demo runtime directory is required');
mkdirSync(runtime,{mode:0o700});
const local=path.join(runtime,'public/local');
mkdirSync(local,{recursive:true,mode:0o700});
writeFileSync(path.join(local,'usage.json'),JSON.stringify(demoData()),{flag:'wx',mode:0o600});
console.log('Synthetic Windows test runtime prepared. No source records were read.');
