// An optional MCP server (stdio, JSON-RPC 2.0, one message per line) that lets the user's own Claude
// client compose dashboard views. It has four tools: get_catalog, compose_view, list_views and
// remove_view. A composed view is a spec of blocks whose props are queries, so the server never
// reads usage data, transcripts or snapshots, and no number leaves the computer. It writes only
// saved views, in <dataFolder>/public/local/views/. See docs/MCP.md.
import path from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../lib/config.mjs';
import {z} from 'zod';
import {BLOCK_TYPES,DIMS,METRICS,METRIC_DIMS,SPEC_LIMITS} from '../lib/r2-blocks.mjs';
import {DESCRIPTIONS,PROP_SCHEMAS} from '../lib/r2-catalog.mjs';
import {TITLE_MAX,QUESTION_MAX,VIEW_ID,listViews,removeView,saveView} from '../lib/saved-views.mjs';
import {ROLES} from '../lib/roles.mjs';

export const PROTOCOL_VERSIONS=Object.freeze(['2025-11-25','2025-06-18','2025-03-26','2024-11-05']);
export const SERVER_INFO=Object.freeze({name:'observatory',title:'Observatory dashboard views',version:'1.0.0'});
const INSTRUCTIONS='Compose and save dashboard views for Observatory. Call get_catalog first, then compose_view with a spec of blocks. '+
  'A block holds queries (which metric, which breakdown), never numbers or names, and this server has no access to any usage data.';

const PARSE_ERROR=-32700,INVALID_REQUEST=-32600,METHOD_NOT_FOUND=-32601,INVALID_PARAMS=-32602,INTERNAL_ERROR=-32603;
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);

const idSchema={type:'string',pattern:'^[a-z0-9-]{1,48}$',description:'Lowercase letters, digits and dashes, 1 to 48 characters.'};
const TOOLS=[
  {name:'get_catalog',title:'Get the block catalog',
    description:'Returns the blocks a view can be composed from, the props each takes, the metrics and breakdowns, the limits and an example spec. Read-only; it holds no usage data.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
  {name:'compose_view',title:'Compose and save a view',
    description:'Checks a spec against the block catalog and saves it as a view the dashboard lists. A spec that fails the check, is over the limits or names an unknown block is refused with the reasons. An existing id is refused unless replace is true.',
    inputSchema:{type:'object',properties:{
      id:idSchema,
      title:{type:'string',minLength:1,maxLength:TITLE_MAX,description:'Plain text shown as the view title.'},
      question:{type:['string','null'],maxLength:QUESTION_MAX,description:'The question the view answers, shown under the title. Optional.'},
      spec:{type:'object',description:'A flat spec: {"root": "<id>", "elements": {"<id>": {"type": "<block>", "props": {...}, "children": ["<id>"]}}}. See get_catalog.'},
      replace:{type:'boolean',description:'Overwrite a saved view with the same id. Default false.'}},
    required:['id','title','spec'],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
  {name:'list_views',title:'List saved views',
    description:'Lists the saved views, newest first. Pass id to get one view with its spec, for example to change it and save it again with replace.',
    inputSchema:{type:'object',properties:{id:idSchema},additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
  {name:'remove_view',title:'Remove a saved view',
    description:'Deletes one saved view by id. Nothing else is touched.',
    inputSchema:{type:'object',properties:{id:idSchema},required:['id'],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false}},
];

const EXAMPLE={root:'page',elements:{
  page:{type:'Section',props:{title:'Where the money went',columns:6},children:['spend','byRepo']},
  spend:{type:'Headline',props:{metric:'spend',breakdowns:['repo','model'],scope:{range:{unit:'week'}}}},
  byRepo:{type:'Breakdown',props:{metric:'spend',dim:'repo',limit:6,scope:{range:{unit:'week'}}}}}};

export function catalogDescription() {
  return {
    note:'A spec holds queries, not data. Each block asks the dashboard for its numbers when it draws. Use only the props listed.',
    blocks:Object.fromEntries(BLOCK_TYPES.map(type=>[type,{
      about:DESCRIPTIONS[type],holdsChildren:type==='Section',
      // The same zod schema the check uses (lib/r2-catalog.mjs), as JSON Schema, so the two cannot drift.
      props:z.toJSONSchema(PROP_SCHEMAS[type])}])),
    metrics:METRICS,dims:DIMS,metricDims:METRIC_DIMS,roles:ROLES,
    limits:{...SPEC_LIMITS,titleCharacters:TITLE_MAX,questionCharacters:QUESTION_MAX},
    spec:'{"root": "<element id>", "elements": {"<element id>": {"type": "<block>", "props": {...}, "children": ["<element id>"]}}}. The root is a Section and only Section has children. Every element must be reachable from the root, once. A metric splits only by the dims metricDims lists for it.',
    example:EXAMPLE,
  };
}

const text=value=>({type:'text',text:typeof value==='string'?value:JSON.stringify(value,null,2)});
const ok=value=>({content:[text(value)],structuredContent:value,isError:false});
// A refused call is a tool result, not a protocol error, so the model sees the reasons and can retry.
const refused=(message,errors)=>({content:[text(errors?.length?`${message}\n- ${errors.join('\n- ')}`:message)],isError:true});

function checkArguments(tool,args) {
  const schema=tool.inputSchema,errors=[];
  if(args!==undefined && !object(args))return ['arguments must be an object'];
  const given=args??{};
  for(const key of Object.keys(given))if(!schema.properties[key])errors.push(`${key} is not an argument of ${tool.name}`);
  for(const key of schema.required??[])if(given[key]===undefined)errors.push(`${key} is required`);
  return errors;
}

/**
 * The server's brain, apart from the byte stream so tests can call it directly.
 * handle(message) returns the response object, or null for a notification.
 * @param {{dataFolder: string, now?: () => number}} options
 */
export function createMcpServer({dataFolder,now=Date.now}) {
  const reply=(id,result)=>({jsonrpc:'2.0',id,result});
  const failure=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});

  async function callTool(name,args) {
    const tool=TOOLS.find(item=>item.name===name);
    const problems=checkArguments(tool,args);
    if(problems.length)return refused(`Invalid arguments for ${name}.`,problems);
    if(name==='get_catalog')return ok(catalogDescription());
    if(name==='compose_view') {
      if(typeof args.id!=='string' || !VIEW_ID.test(args.id))return refused('Invalid arguments for compose_view.',['id must be lowercase letters, digits and dashes, 1 to 48 characters']);
      if(args.replace!==undefined && typeof args.replace!=='boolean')return refused('Invalid arguments for compose_view.',['replace must be true or false']);
      const saved=await saveView(dataFolder,{id:args.id,title:args.title,question:args.question??null,spec:args.spec},{replace:args.replace===true,now:now()});
      if(!saved.ok)return refused('The view was not saved.',saved.errors);
      return ok({saved:true,replaced:saved.replaced,id:saved.view.id,savedAt:saved.view.savedAt,note:'The dashboard lists it under saved views.'});
    }
    if(name==='list_views') {
      const views=await listViews(dataFolder);
      if(args?.id!==undefined) {
        const view=views.find(item=>item.id===args.id);
        return view?ok(view):refused(`No saved view with id ${args.id}.`);
      }
      return ok({count:views.length,limit:SPEC_LIMITS.savedViews,views:views.map(({id,title,question,savedAt,origin,spec})=>({id,title,question,savedAt,origin,elements:Object.keys(spec.elements).length}))});
    }
    if(name==='remove_view') {
      let removed;
      try {removed=await removeView(dataFolder,args.id);}catch(error) {return refused(error.message);}
      return removed?ok({removed:true,id:args.id}):refused(`No saved view with id ${args.id}.`);
    }
    return refused(`Unknown tool ${name}.`);
  }

  async function handleOne(message) {
    if(!object(message) || message.jsonrpc!=='2.0' || typeof message.method!=='string' ||
      (message.id!==undefined && typeof message.id!=='string' && typeof message.id!=='number'))
      return failure(object(message) && (typeof message.id==='string' || typeof message.id==='number')?message.id:null,INVALID_REQUEST,'Invalid request');
    const {id,method,params}=message;
    // No id: a notification. Nothing is sent back, whatever it was.
    if(id===undefined)return null;
    try {
      if(method==='initialize') {
        const asked=params?.protocolVersion;
        return reply(id,{protocolVersion:PROTOCOL_VERSIONS.includes(asked)?asked:PROTOCOL_VERSIONS[0],
          capabilities:{tools:{listChanged:false}},serverInfo:SERVER_INFO,instructions:INSTRUCTIONS});
      }
      if(method==='ping')return reply(id,{});
      if(method==='tools/list')return reply(id,{tools:TOOLS});
      if(method==='tools/call') {
        if(!object(params) || typeof params.name!=='string')return failure(id,INVALID_PARAMS,'tools/call needs a tool name');
        if(!TOOLS.some(tool=>tool.name===params.name))return failure(id,INVALID_PARAMS,`Unknown tool: ${params.name}`);
        try {return reply(id,await callTool(params.name,params.arguments));}
        catch(error) {return reply(id,refused(`${params.name} failed: ${error.message}`));}
      }
      return failure(id,METHOD_NOT_FOUND,`Method not found: ${method}`);
    } catch(error) {return failure(id,INTERNAL_ERROR,error.message);}
  }

  async function handle(message) {
    if(Array.isArray(message)) {
      if(!message.length)return failure(null,INVALID_REQUEST,'Invalid request');
      const out=(await Promise.all(message.map(handleOne))).filter(Boolean);
      return out.length?out:null;
    }
    return handleOne(message);
  }
  return {handle,tools:TOOLS};
}

/** Reads one JSON message per line from input, answers in order on output. Resolves when input ends. */
export async function serve({input,output,server}) {
  const lines=createInterface({input,crlfDelay:Infinity});
  const send=message=>{if(message!==null)output.write(`${JSON.stringify(message)}\n`);};
  for await(const line of lines) {
    if(!line.trim())continue;
    let message;
    try {message=JSON.parse(line);}catch {send(failure(null,PARSE_ERROR,'Parse error'));continue;}
    send(await server.handle(message));
  }
}
const failure=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let config;
  try {config=await loadConfig();}
  catch(error) {console.error(`Observatory MCP server: ${error.message}`);process.exit(1);}
  // Stdout carries protocol messages only. Anything else goes to stderr.
  const server=createMcpServer({dataFolder:config.dataFolder});
  await serve({input:process.stdin,output:process.stdout,server});
}
