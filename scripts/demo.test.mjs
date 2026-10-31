import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {checkDemo} from './demo.mjs';

const fictional={demo:true,devices:[{host:'Mac',name:'Studio Mac'},{host:'Windows',name:'Desk PC'}]};

async function demoFolder({html='<script type="module" src="./assets/index-a1.js"></script>',data=fictional,extra={}}={}) {
  const dir=await mkdtemp(path.join(tmpdir(),'observatory-demo-'));
  await mkdir(path.join(dir,'assets'));
  await mkdir(path.join(dir,'local'));
  const files={'index.html':html,'assets/index-a1.js':'fetch("./local/combined.json")','local/combined.json':JSON.stringify(data),...extra};
  for (const [file,text] of Object.entries(files)) await writeFile(path.join(dir,file),text);
  return dir;
}

test('the demo check passes fictional output and refuses anything else',async()=>{
  assert.deepEqual(await checkDemo(await demoFolder()),[]);
  const refused=async options=>(await checkDemo(await demoFolder(options))).length>0;
  assert.ok(await refused({data:{...fictional,demo:undefined}}));
  assert.ok(await refused({data:{...fictional,devices:[{name:'Real Laptop'}]}}));
  assert.ok(await refused({data:{...fictional,path:'/Users/someone/project'}}));
  assert.ok(await refused({data:{...fictional,path:'/home/someone/project'}}));
  assert.ok(await refused({data:{...fictional,path:'C:\\Users\\someone'}}));
  assert.ok(await refused({extra:{'assets/index-a1.js':'fetch("http://127.0.0.1:5601/local/combined.json")'}}));
  assert.ok(await refused({extra:{'assets/index-a1.js.map':'{}'}}));
  assert.ok(await refused({html:'<script type="module" src="/assets/index-a1.js"></script>'}));
});
