// Saved views: specs an agent composed through the optional MCP server (scripts/mcp-server.mjs).
// They live in <dataFolder>/public/local/views/<id>.json and are drawn by the same json-render
// renderer as the built-in views. A spec holds block names and query props, never usage data.
//
// Every check is the block catalog's (lib/r2-catalog.mjs checkSpec and checkSavedView), so the MCP
// server, the dashboard route and the dashboard itself refuse the same specs. Everything that reads a
// saved view checks it again: the folder is the user's, so a file in it may have been edited by hand.
// Nothing here writes outside that folder.
import {lstat,mkdir,readdir,readFile,realpath,unlink} from 'node:fs/promises';
import path from 'node:path';
import {writeJsonAtomic} from './atomic-file.mjs';
import {SPEC_LIMITS} from './r2-blocks.mjs';
import {checkSpec as catalogCheckSpec,checkSavedView} from './r2-catalog.mjs';

export const VIEWS_SCHEMA='observatory-views/1';
export const VIEW_ID=/^[a-z0-9-]{1,48}$/;
export const TITLE_MAX=80;
export const QUESTION_MAX=200;
const MAX_VIEW_FILE=SPEC_LIMITS.bytes+2_000;

/**
 * Checks a spec against the block catalog and SPEC_LIMITS.
 * @param {unknown} spec
 * @returns {{ok: boolean, errors: string[]}}
 */
export function checkSpec(spec) {
  const result=catalogCheckSpec(spec);
  return result.ok?{ok:true,errors:[]}:{ok:false,errors:result.errors.slice(0,20)};
}

/**
 * Checks a whole saved view with the catalog: its fields, then its spec.
 * @returns {{ok: boolean, errors: string[]}}
 */
export function checkView(view) {
  const result=checkSavedView(view);
  return result.ok?{ok:true,errors:[]}:{ok:false,errors:result.errors.slice(0,20)};
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

async function readView(folder,name) {
  const file=path.join(folder,name);
  try {
    const info=await lstat(file);
    if(!info.isFile() || info.size>MAX_VIEW_FILE)return null;
    const view=JSON.parse(await readFile(file,'utf8'));
    // The file name is the id, so a renamed or copied file is not a second view.
    return checkView(view).ok && `${view.id}.json`===name?view:null;
  } catch {return null;}
}

/**
 * Every saved view that still passes the check, newest first. A missing folder is an empty list.
 * Files that fail the check are left alone on disk and left out of the list.
 */
export async function listViews(dataFolder) {
  const folder=await safeFolder(dataFolder);
  if(!folder)return [];
  const names=(await readdir(folder)).filter(name=>name.endsWith('.json') && VIEW_ID.test(name.slice(0,-5))).sort();
  const views=(await Promise.all(names.slice(0,SPEC_LIMITS.savedViews*2).map(name=>readView(folder,name)))).filter(Boolean);
  return views.sort((a,b)=>b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id)).slice(0,SPEC_LIMITS.savedViews);
}

/**
 * Saves a composed view. Refuses a spec that fails the check, an id that is taken (unless replace),
 * and a 51st view. The write is atomic and stays inside the views folder.
 * @returns {Promise<{ok: true, view: object, replaced: boolean} | {ok: false, errors: string[]}>}
 */
export async function saveView(dataFolder,{id,title,question=null,spec},{replace=false,now=Date.now()}={}) {
  const view={id,title,question,spec,savedAt:new Date(now).toISOString(),origin:'composed'};
  const check=checkView(view);
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
