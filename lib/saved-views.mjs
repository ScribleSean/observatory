// Saved views: specs an agent composed through the optional MCP server (scripts/mcp-server.mjs).
// They live in <dataFolder>/public/local/views/<id>.json and are drawn by the same json-render
// renderer as the built-in views. A spec holds block names and query props, never usage data.
//
// Everything that reads a saved view checks it again: the folder is the user's, so a file in it may
// have been edited by hand. Nothing here writes outside that folder.
import {lstat,mkdir,readdir,readFile,realpath,unlink} from 'node:fs/promises';
import path from 'node:path';
import {writeJsonAtomic} from './atomic-file.mjs';
import {BLOCK_TYPES,DIMS,METRICS,METRIC_DIMS,SPEC_LIMITS} from './r2-blocks.mjs';
import {RANGE_UNITS,SOURCE_IDS} from './scope.mjs';
import {ROLES} from './roles.mjs';

export const VIEWS_SCHEMA='observatory-views/1';
export const VIEW_ID=/^[a-z0-9-]{1,48}$/;
export const TITLE_MAX=80;
export const QUESTION_MAX=200;
// The seam for lane b. lib/r2-catalog.mjs (the zod catalog) lands in parallel. When it does, install its
// spec check here, once, as (spec) => {ok, errors?} (or true/false, or throw): checkSpec then runs it
// after the contract checks below, for the MCP server and for the dashboard route alike.
let installedCatalogCheck=null;
export const installCatalogCheck=check=>{installedCatalogCheck=check;};
const HOSTS=['Mac','Windows','Linux'];
const MAX_VIEW_FILE=SPEC_LIMITS.bytes+2_000;
// oxlint-disable-next-line no-control-regex -- refusing control characters is the point
const control=/[\u0000-\u001f\u007f]/;
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const plain=value=>object(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));

// One table drives both the check and the description get_catalog gives an agent, so they cannot drift.
// kinds: enum (one of values), flags (a list of distinct values), int, bool, text, id, date, scope.
const enumOf=values=>({kind:'enum',values});
const flagsOf=values=>({kind:'flags',values});
const SCOPE={kind:'scope'};
const DIM_OR_NULL={kind:'enum',values:DIMS,nullable:true};
export const BLOCK_PROPS=Object.freeze({
  Section:{children:true,props:{
    title:{kind:'text',max:TITLE_MAX,nullable:true,required:true,about:'A plain label for the group. Never a number or a session name.'},
    columns:{...enumOf([1,2,3,4,6,12]),required:true,about:'Columns each child spans on the 12-column grid.'}}},
  Headline:{props:{
    metric:{...enumOf(METRICS),required:true},
    compare:{kind:'bool',about:'Default true.'},
    breakdowns:{...flagsOf(DIMS),about:'Only dims the metric supports (METRIC_DIMS). Default: all of them.'},
    scope:SCOPE}},
  SpendLandedChart:{props:{
    stack:{kind:'enum',values:['device','model','role'],nullable:true,about:'Default null.'},
    scope:SCOPE}},
  SessionsTable:{props:{
    groupBy:{kind:'enum',values:['role','device','repo'],nullable:true},
    role:{kind:'enum',values:ROLES,nullable:true},
    running:{kind:'bool',about:'Only sessions running now.'},
    sort:enumOf(['spend','onMain','perLanded','startedAt']),
    limit:{kind:'int',min:1,max:100,about:'Default 25.'},
    scope:SCOPE}},
  Breakdown:{props:{
    metric:{...enumOf(METRICS),required:true},
    dim:{...enumOf(DIMS),required:true,about:'Must be a dim the metric supports (METRIC_DIMS).'},
    limit:{kind:'int',min:1,max:50,about:'Default 8, the rest as Other.'},
    scope:SCOPE}},
  LimitMeter:{props:{
    engine:{...enumOf(['claude','codex','grok']),required:true},
    window:{kind:'id',nullable:true,about:'A window id, else every window of the engine.'},
    history:{kind:'bool',about:'Show the past windows chart. Default false.'}}},
  GrokRequests:{props:{scope:SCOPE}},
  Timeline:{props:{
    series:{...enumOf(['spend','tokens','screenTime','grokRequests','subagents']),required:true},
    by:DIM_OR_NULL,
    scope:SCOPE}},
  Flags:{props:{
    limit:{kind:'int',min:1,max:20,about:'Default 4.'},
    scope:SCOPE}},
});

const isDate=text=>typeof text==='string' && /^\d{4}-\d\d-\d\d$/.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0,10)===text;
const same=(list,values)=>Array.isArray(list) && new Set(list).size===list.length && list.every(item=>values.includes(item));

function checkScope(value,where,errors) {
  if(!plain(value)) {errors.push(`${where} must be an object`);return;}
  for(const key of Object.keys(value)) {
    if(!['devices','range','sources'].includes(key))errors.push(`${where}.${key} is not a scope field (use devices, range or sources)`);
  }
  if(value.devices!==undefined && !same(value.devices,HOSTS))errors.push(`${where}.devices must be a list of ${HOSTS.join(', ')}, once each`);
  if(value.sources!==undefined && !same(value.sources,SOURCE_IDS))errors.push(`${where}.sources must be a list of ${SOURCE_IDS.join(', ')}, once each`);
  if(value.range!==undefined) {
    const range=value.range;
    if(!plain(range))errors.push(`${where}.range must be an object`);
    else {
      for(const key of Object.keys(range))if(!['unit','anchor'].includes(key))errors.push(`${where}.range.${key} is not a range field (use unit or anchor)`);
      if(range.unit!==undefined && !RANGE_UNITS.includes(range.unit))errors.push(`${where}.range.unit must be one of ${RANGE_UNITS.join(', ')}`);
      if(range.anchor!==undefined && !isDate(range.anchor))errors.push(`${where}.range.anchor must be a date as YYYY-MM-DD`);
    }
  }
}

function checkProp(rule,value,where,errors) {
  if(rule.kind==='scope')return checkScope(value,where,errors);
  if(value===null) {if(!rule.nullable)errors.push(`${where} cannot be null`);return;}
  switch(rule.kind) {
    case 'enum': if(!rule.values.includes(value))errors.push(`${where} must be one of ${rule.values.join(', ')}${rule.nullable?', or null':''}`);return;
    case 'flags': if(!same(value,rule.values))errors.push(`${where} must be a list of distinct values from ${rule.values.join(', ')}`);return;
    case 'bool': if(typeof value!=='boolean')errors.push(`${where} must be true or false`);return;
    case 'int': if(!Number.isInteger(value) || value<rule.min || value>rule.max)errors.push(`${where} must be a whole number from ${rule.min} to ${rule.max}`);return;
    case 'id': if(typeof value!=='string' || !/^[A-Za-z0-9._-]{1,40}$/.test(value))errors.push(`${where} must be a short id of letters, digits, dots, dashes or underscores`);return;
    case 'text': if(typeof value!=='string' || !value.trim() || value.length>rule.max || control.test(value))errors.push(`${where} must be plain text of 1 to ${rule.max} characters`);return;
    default: errors.push(`${where} has no rule`);
  }
}

function checkProps(type,props,where,errors) {
  const rules=BLOCK_PROPS[type].props;
  if(!plain(props)) {errors.push(`${where}.props must be an object`);return;}
  for(const key of Object.keys(props))if(!rules[key])errors.push(`${where}.props.${key} is not a ${type} prop (it takes ${Object.keys(rules).join(', ')||'none'})`);
  for(const [key,rule] of Object.entries(rules)) {
    if(props[key]===undefined) {if(rule.required)errors.push(`${where}.props.${key} is required`);continue;}
    checkProp(rule,props[key],`${where}.props.${key}`,errors);
  }
  // A metric only splits by the dims it supports: a commit is not made by a model.
  const dims=METRIC_DIMS[props.metric];
  if(dims && type==='Breakdown' && DIMS.includes(props.dim) && !dims.includes(props.dim))
    errors.push(`${where}.props.dim ${props.dim} is not available for metric ${props.metric} (it supports ${dims.join(', ')||'none'})`);
  if(dims && type==='Headline' && Array.isArray(props.breakdowns)) {
    const bad=props.breakdowns.filter(dim=>DIMS.includes(dim) && !dims.includes(dim));
    if(bad.length)errors.push(`${where}.props.breakdowns ${bad.join(', ')} not available for metric ${props.metric} (it supports ${dims.join(', ')||'none'})`);
  }
}

/**
 * Checks a spec against the contract: the limits, the block names, the props each block takes and
 * the tree shape. It runs before and beside the catalog check from lib/r2-catalog.mjs, which is
 * passed in as `catalogCheck` when that module exists: (spec) => {ok, errors?} (or true/false).
 * Props are queries, so any value that is not a query word, a flag, a short label or a scope patch is refused.
 * @param {unknown} spec
 * @param {{catalogCheck?: ((spec: object) => unknown) | null}} [options]
 * @returns {{ok: boolean, errors: string[]}}
 */
export function checkSpec(spec,{catalogCheck=installedCatalogCheck}={}) {
  const errors=[];
  const done=()=>({ok:errors.length===0,errors:errors.slice(0,20)});
  if(!plain(spec)) {errors.push('spec must be an object with root and elements');return done();}
  for(const key of Object.keys(spec))if(!['root','elements'].includes(key))errors.push(`spec.${key} is not allowed (use root and elements)`);
  let bytes;
  try {bytes=Buffer.byteLength(JSON.stringify(spec));}catch {errors.push('spec must be plain JSON');return done();}
  if(bytes>SPEC_LIMITS.bytes)errors.push(`spec is ${bytes} bytes, over the limit of ${SPEC_LIMITS.bytes}`);
  const {root,elements}=spec;
  if(typeof root!=='string' || !root)errors.push('spec.root must be the id of an element');
  if(!plain(elements)) {errors.push('spec.elements must be an object of elements by id');return done();}
  const ids=Object.keys(elements);
  if(ids.length<1 || ids.length>SPEC_LIMITS.elements)errors.push(`spec.elements has ${ids.length} elements, the limit is 1 to ${SPEC_LIMITS.elements}`);
  if(ids.length>SPEC_LIMITS.elements*2)return done();
  if(!(typeof root==='string' && ids.includes(root))) {errors.push('spec.root names no element');return done();}
  for(const id of ids) {
    const element=elements[id],where=`elements.${id}`;
    if(!plain(element)) {errors.push(`${where} must be an object`);continue;}
    for(const key of Object.keys(element))if(!['type','props','children'].includes(key))errors.push(`${where}.${key} is not allowed (use type, props and children)`);
    if(!BLOCK_TYPES.includes(element.type)) {errors.push(`${where}.type ${JSON.stringify(element.type)} is not a block (use ${BLOCK_TYPES.join(', ')})`);continue;}
    checkProps(element.type,element.props??{},where,errors);
    const children=element.children??[];
    if(!Array.isArray(children) || children.some(child=>typeof child!=='string'))errors.push(`${where}.children must be a list of element ids`);
    else if(children.length && !BLOCK_PROPS[element.type].children)errors.push(`${where}: only Section holds children`);
    else for(const child of children)if(!ids.includes(child))errors.push(`${where}.children names a missing element ${JSON.stringify(child)}`);
  }
  if(errors.length)return done();
  // A tree: every element reached once from the root, none twice, none left over, no deeper than the limit.
  const seen=new Set();
  const walk=(id,depth)=>{
    if(seen.has(id)) {errors.push(`element ${id} is used more than once or loops`);return;}
    seen.add(id);
    if(depth>SPEC_LIMITS.depth) {errors.push(`spec is deeper than ${SPEC_LIMITS.depth} levels`);return;}
    for(const child of elements[id].children??[])walk(child,depth+1);
  };
  walk(root,1);
  const orphans=ids.filter(id=>!seen.has(id));
  if(!errors.length && orphans.length)errors.push(`elements not reachable from the root: ${orphans.slice(0,5).join(', ')}`);
  if(errors.length || !catalogCheck)return done();
  try {
    const result=catalogCheck(spec);
    const ok=result===undefined || result===true || (object(result) && result.ok!==false && result.success!==false);
    if(!ok)errors.push(...(object(result) && Array.isArray(result.errors) && result.errors.length?result.errors.map(String):['the block catalog refused the spec']));
  } catch(error) {errors.push(`the block catalog refused the spec: ${error.message}`);}
  return done();
}

/**
 * Checks a whole saved view: its fields, then its spec.
 * @returns {{ok: boolean, errors: string[]}}
 */
export function checkView(view,options={}) {
  const errors=[];
  if(!plain(view))return {ok:false,errors:['view must be an object']};
  for(const key of Object.keys(view))if(!['id','title','question','spec','savedAt','origin'].includes(key))errors.push(`view.${key} is not allowed`);
  if(typeof view.id!=='string' || !VIEW_ID.test(view.id))errors.push('id must be lowercase letters, digits and dashes, 1 to 48 characters');
  if(typeof view.title!=='string' || !view.title.trim() || view.title.length>TITLE_MAX || control.test(view.title))errors.push(`title must be plain text of 1 to ${TITLE_MAX} characters`);
  if(view.question!==null && (typeof view.question!=='string' || !view.question.trim() || view.question.length>QUESTION_MAX || control.test(view.question)))
    errors.push(`question must be null or plain text of 1 to ${QUESTION_MAX} characters`);
  if(typeof view.savedAt!=='string' || Number.isNaN(Date.parse(view.savedAt)) || new Date(view.savedAt).toISOString()!==view.savedAt)errors.push('savedAt must be an ISO date');
  if(!['built-in','composed'].includes(view.origin))errors.push('origin must be built-in or composed');
  const spec=checkSpec(view.spec,options);
  errors.push(...spec.errors);
  return {ok:errors.length===0,errors};
}

export const viewsFolder=dataFolder=>path.join(dataFolder,'public','local','views');

// The folder must be a real folder inside the data folder, never a link out of it.
async function safeFolder(dataFolder,{create=false}={}) {
  const folder=viewsFolder(dataFolder);
  if(create)await mkdir(folder,{recursive:true,mode:0o700});
  let info;
  try {info=await lstat(folder);}catch(error) {if(error.code==='ENOENT')return null;throw error;}
  if(!info.isDirectory())throw Error('The saved views folder is not a folder');
  const root=await realpath(dataFolder);
  if(await realpath(folder)!==path.join(root,'public','local','views'))throw Error('The saved views folder is linked elsewhere');
  return folder;
}

async function readView(folder,name,options) {
  const file=path.join(folder,name);
  try {
    const info=await lstat(file);
    if(!info.isFile() || info.size>MAX_VIEW_FILE)return null;
    const view=JSON.parse(await readFile(file,'utf8'));
    // The file name is the id, so a renamed or copied file is not a second view.
    return checkView(view,options).ok && `${view.id}.json`===name?view:null;
  } catch {return null;}
}

/**
 * Every saved view that still passes the check, newest first. A missing folder is an empty list.
 * Files that fail the check are left alone on disk and left out of the list.
 */
export async function listViews(dataFolder,options={}) {
  const folder=await safeFolder(dataFolder);
  if(!folder)return [];
  const names=(await readdir(folder)).filter(name=>name.endsWith('.json') && VIEW_ID.test(name.slice(0,-5))).sort();
  const views=(await Promise.all(names.slice(0,SPEC_LIMITS.savedViews*2).map(name=>readView(folder,name,options)))).filter(Boolean);
  return views.sort((a,b)=>b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id)).slice(0,SPEC_LIMITS.savedViews);
}

/**
 * Saves a composed view. Refuses a spec that fails the check, an id that is taken (unless replace),
 * and a 51st view. The write is atomic and stays inside the views folder.
 * @returns {Promise<{ok: true, view: object, replaced: boolean} | {ok: false, errors: string[]}>}
 */
export async function saveView(dataFolder,{id,title,question=null,spec},{replace=false,now=Date.now(),catalogCheck=installedCatalogCheck}={}) {
  const view={id,title,question,spec,savedAt:new Date(now).toISOString(),origin:'composed'};
  const check=checkView(view,{catalogCheck});
  if(!check.ok)return {ok:false,errors:check.errors};
  const folder=await safeFolder(dataFolder,{create:true});
  const file=path.join(folder,`${id}.json`);
  const existing=await lstat(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
  if(existing && !replace)return {ok:false,errors:[`A saved view with id ${id} already exists. Pass replace: true to overwrite it, or choose another id.`]};
  if(!existing && (await readdir(folder)).filter(name=>VIEW_ID.test(name.slice(0,-5)) && name.endsWith('.json')).length>=SPEC_LIMITS.savedViews)
    return {ok:false,errors:[`There are already ${SPEC_LIMITS.savedViews} saved views. Remove one first.`]};
  await writeJsonAtomic(file,view);
  return {ok:true,view,replaced:existing};
}

/** Removes one saved view by id. Returns false when there is no such view. */
export async function removeView(dataFolder,id) {
  if(typeof id!=='string' || !VIEW_ID.test(id))throw Error('id must be lowercase letters, digits and dashes, 1 to 48 characters');
  const folder=await safeFolder(dataFolder);
  if(!folder)return false;
  const file=path.join(folder,`${id}.json`);
  const info=await lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!info)return false;
  if(!info.isFile())throw Error('Not a saved view file');
  await unlink(file);
  return true;
}
