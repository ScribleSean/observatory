import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readdir,readFile,writeFile,symlink} from 'node:fs/promises';
import path from 'node:path';
import {withFolder} from './helpers.mjs';
import {SPEC_LIMITS,METRIC_DIMS,DIMS} from '../lib/r2-blocks.mjs';
import {checkSpec,checkView,installCatalogCheck,listViews,removeView,saveView,viewsFolder} from '../lib/saved-views.mjs';

const good=()=>({root:'page',elements:{
  page:{type:'Section',props:{title:'Spend',columns:6},children:['spend','byRepo']},
  spend:{type:'Headline',props:{metric:'spend',breakdowns:['repo','model'],scope:{range:{unit:'week',anchor:'2026-11-18'},devices:['Mac'],sources:['claude']}}},
  byRepo:{type:'Breakdown',props:{metric:'spend',dim:'repo',limit:6}}}});
const errorsOf=spec=>checkSpec(spec).errors.join('\n');

test('a spec that follows the contract is accepted',()=>{
  assert.deepEqual(checkSpec(good()),{ok:true,errors:[]});
});

test('a spec that is not an object, has extra keys, or has no root is refused',()=>{
  assert.equal(checkSpec(null).ok,false);
  assert.equal(checkSpec([]).ok,false);
  assert.match(errorsOf({...good(),state:{}}),/spec\.state is not allowed/);
  assert.match(errorsOf({...good(),root:'nope'}),/names no element/);
  assert.match(errorsOf({root:'a',elements:{}}),/1 to 40/);
});

test('an unknown block, an unknown prop and a wrong value are refused',()=>{
  const spec=good();spec.elements.spend.type='Gauge';
  assert.match(errorsOf(spec),/not a block/);
  const extra=good();extra.elements.spend.props.value=42;
  assert.match(errorsOf(extra),/props\.value is not a Headline prop/);
  const metric=good();metric.elements.spend.props.metric='profit';
  assert.match(errorsOf(metric),/metric must be one of/);
  const scope=good();scope.elements.spend.props.scope={range:{unit:'decade'}};
  assert.match(errorsOf(scope),/range\.unit must be one of/);
  const date=good();date.elements.spend.props.scope={range:{anchor:'2026-02-31'}};
  assert.match(errorsOf(date),/YYYY-MM-DD/);
});

test('numbers and names cannot be smuggled in as props',()=>{
  for(const bad of [{limit:'25'},{limit:25.5},{limit:0},{limit:101},{limit:1e9},{title:'x'}]) {
    const spec=good();spec.elements.byRepo.props={...spec.elements.byRepo.props,...bad};
    assert.equal(checkSpec(spec).ok,false,JSON.stringify(bad));
  }
  const total=good();total.elements.spend.props.total=1234;
  assert.equal(checkSpec(total).ok,false);
  const section=good();section.elements.page.props.title='x'.repeat(81);
  assert.match(errorsOf(section),/title must be plain text/);
  const control=good();control.elements.page.props.title='a\nb';
  assert.equal(checkSpec(control).ok,false);
});

test('a metric only splits by the dims the contract lists for it',()=>{
  const spec=good();spec.elements.byRepo.props={metric:'onMain',dim:'model'};
  assert.match(errorsOf(spec),/dim model is not available for metric onMain/);
  const headline=good();headline.elements.spend.props={metric:'grokRequests',breakdowns:['repo']};
  assert.match(errorsOf(headline),/breakdowns repo not available/);
  // every pair the contract allows is accepted
  for(const [metric,dims] of Object.entries(METRIC_DIMS))for(const dim of dims) {
    const ok=good();ok.elements.byRepo.props={metric,dim};
    assert.equal(checkSpec(ok).ok,true,`${metric} by ${dim}`);
  }
  for(const dim of DIMS)if(!METRIC_DIMS.tokens.includes(dim)) {
    const no=good();no.elements.byRepo.props={metric:'tokens',dim};
    assert.equal(checkSpec(no).ok,false,`tokens by ${dim}`);
  }
});

test('SPEC_LIMITS: too many elements, too deep, too many bytes',()=>{
  const wide={root:'r',elements:{r:{type:'Section',props:{title:null,columns:1},children:[]}}};
  for(let i=0;i<SPEC_LIMITS.elements;i++) {wide.elements[`e${i}`]={type:'Flags',props:{}};wide.elements.r.children.push(`e${i}`);}
  assert.match(errorsOf(wide),/41 elements/);
  wide.elements.r.children.pop();delete wide.elements[`e${SPEC_LIMITS.elements-1}`];
  assert.equal(checkSpec(wide).ok,true,'exactly the element limit');
  const deep=(levels)=>{
    const spec={root:'s0',elements:{}};
    for(let i=0;i<levels;i++)spec.elements[`s${i}`]={type:'Section',props:{title:null,columns:12},children:i<levels-1?[`s${i+1}`]:[]};
    return spec;
  };
  assert.equal(checkSpec(deep(SPEC_LIMITS.depth)).ok,true,'exactly the depth limit');
  assert.match(errorsOf(deep(SPEC_LIMITS.depth+1)),/deeper than 4/);
  const big=good();big.elements.pad={type:'Flags',props:{},note:'x'.repeat(SPEC_LIMITS.bytes)};big.elements.page.children.push('pad');
  assert.match(errorsOf(big),/over the limit/);
});

test('the tree must be a tree: children exist, are used once, are reachable, and only Section has them',()=>{
  const missing=good();missing.elements.page.children.push('ghost');
  assert.match(errorsOf(missing),/missing element "ghost"/);
  const twice=good();twice.elements.page.children.push('spend');
  assert.match(errorsOf(twice),/more than once/);
  const loop=good();loop.elements.page.children.push('page');
  assert.match(errorsOf(loop),/more than once or loops/);
  const orphan=good();orphan.elements.lonely={type:'Flags',props:{}};
  assert.match(errorsOf(orphan),/not reachable/);
  const leaf=good();leaf.elements.spend.children=['byRepo'];leaf.elements.page.children=['spend'];
  assert.match(errorsOf(leaf),/only Section holds children/);
});

test('the installed catalog check runs after the contract checks and can refuse',()=>{
  assert.equal(checkSpec(good(),{catalogCheck:()=>({ok:false,errors:['zod says no']})}).errors[0],'zod says no');
  assert.equal(checkSpec(good(),{catalogCheck:()=>{throw Error('boom');}}).ok,false);
  assert.equal(checkSpec(good(),{catalogCheck:()=>({success:true})}).ok,true);
  let called=0;
  assert.equal(checkSpec({root:'x',elements:{}},{catalogCheck:()=>{called++;}}).ok,false);
  assert.equal(called,0,'a spec that fails the contract never reaches the catalog');
  installCatalogCheck(()=>({ok:false,errors:['installed']}));
  try {assert.deepEqual(checkSpec(good()).errors,['installed']);}
  finally {installCatalogCheck(null);}
  assert.equal(checkSpec(good()).ok,true);
});

test('a view needs a valid id, title, question and date',()=>{
  const view=(change={})=>({id:'week-spend',title:'Week',question:null,spec:good(),savedAt:'2026-11-18T10:00:00.000Z',origin:'composed',...change});
  assert.equal(checkView(view()).ok,true);
  for(const bad of [{id:'Week'},{id:''},{id:'a'.repeat(49)},{id:'../x'},{title:''},{title:'t'.repeat(81)},{question:''},{savedAt:'yesterday'},{origin:'other'},{extra:1}])
    assert.equal(checkView(view(bad)).ok,false,JSON.stringify(bad).slice(0,60));
});

test('save, list, replace and remove stay inside the views folder',()=>withFolder(async folder=>{
  const data=path.join(folder,'data');await mkdir(data);
  assert.deepEqual(await listViews(data),[]);
  const first=await saveView(data,{id:'week-spend',title:'Week spend',question:'Where did it go?',spec:good()},{now:Date.parse('2026-11-18T10:00:00Z')});
  assert.equal(first.ok,true);
  assert.deepEqual(await readdir(viewsFolder(data)),['week-spend.json']);
  const again=await saveView(data,{id:'week-spend',title:'Other',spec:good()});
  assert.equal(again.ok,false);
  assert.match(again.errors[0],/already exists/);
  const replaced=await saveView(data,{id:'week-spend',title:'Other',spec:good()},{replace:true,now:Date.parse('2026-11-18T11:00:00Z')});
  assert.equal(replaced.replaced,true);
  await saveView(data,{id:'older',title:'Older',spec:good()},{now:Date.parse('2026-11-01T00:00:00Z')});
  assert.deepEqual((await listViews(data)).map(view=>view.id),['week-spend','older']);
  assert.equal((await listViews(data))[0].title,'Other');
  assert.equal(await removeView(data,'older'),true);
  assert.equal(await removeView(data,'older'),false);
  await assert.rejects(()=>removeView(data,'../combined'),/id must be/);
  assert.deepEqual(await readdir(path.join(data,'public','local')),['views']);
  assert.deepEqual(await readdir(folder),['data']);
}));

test('a refused save writes nothing',()=>withFolder(async folder=>{
  const bad=good();bad.elements.spend.props.metric='nope';
  const result=await saveView(folder,{id:'bad',title:'Bad',spec:bad});
  assert.equal(result.ok,false);
  assert.deepEqual(await readdir(folder),[]);
  assert.equal((await saveView(folder,{id:'../escape',title:'Bad',spec:good()})).ok,false);
  assert.deepEqual(await readdir(folder),[]);
}));

test('the 51st view is refused, a replace is not',()=>withFolder(async folder=>{
  for(let i=0;i<SPEC_LIMITS.savedViews;i++)assert.equal((await saveView(folder,{id:`v${i}`,title:'V',spec:good()})).ok,true);
  assert.match((await saveView(folder,{id:'extra',title:'V',spec:good()})).errors[0],/already 50/);
  assert.equal((await saveView(folder,{id:'v3',title:'V2',spec:good()},{replace:true})).ok,true);
}));

test('listing drops files that fail the check, are renamed, oversize or linked',()=>withFolder(async folder=>{
  await saveView(folder,{id:'fine',title:'Fine',spec:good()});
  const dir=viewsFolder(folder);
  const text=await readFile(path.join(dir,'fine.json'),'utf8');
  await writeFile(path.join(dir,'copy.json'),text);
  await writeFile(path.join(dir,'broken.json'),'{nope');
  const edited=JSON.parse(text);edited.id='edited';edited.spec.elements.spend.props.metric='secret';
  await writeFile(path.join(dir,'edited.json'),JSON.stringify(edited));
  await writeFile(path.join(dir,'huge.json'),' '.repeat(SPEC_LIMITS.bytes*2)+text);
  await writeFile(path.join(folder,'outside.json'),text);
  await symlink(path.join(folder,'outside.json'),path.join(dir,'linked.json'));
  assert.deepEqual((await listViews(folder)).map(view=>view.id),['fine']);
}));

test('a views folder that is a link out of the data folder is refused',()=>withFolder(async folder=>{
  const data=path.join(folder,'data'),elsewhere=path.join(folder,'elsewhere');
  await mkdir(path.join(data,'public','local'),{recursive:true});await mkdir(elsewhere);
  await symlink(elsewhere,viewsFolder(data));
  await assert.rejects(()=>listViews(data),/not a folder|linked elsewhere/);
  await assert.rejects(()=>saveView(data,{id:'x',title:'X',spec:good()}),/not a folder|linked elsewhere/);
  assert.deepEqual(await readdir(elsewhere),[]);
}));
