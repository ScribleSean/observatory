import {lstat,readFile} from 'node:fs/promises';
import path from 'node:path';
import {readBoundedReceipts as readAgentReceipts} from './bounded-receipts.mjs';
import {pythonReport} from './python-report.mjs';

const numeric=value=>typeof value==='number' && Number.isFinite(value) && value>=0?value:null;
export function cleanLocalModel(raw) {
  if(!Array.isArray(raw?.records) || raw.records.length>2000)throw Error('Invalid benchmark records');
  return {host:'Ubuntu',status:'ok',records:raw.records.map(row=>{
    if(!row || typeof row!=='object' || Array.isArray(row))throw Error('Invalid benchmark row');
    return {model:typeof row.model==='string' && /^[a-zA-Z0-9._:/-]{1,100}$/.test(row.model)?row.model:'unknown',
      status:row.status==='complete'?'complete':'incomplete',
      recordedAt:typeof row.recordedAt==='string' && Number.isFinite(Date.parse(row.recordedAt))?new Date(row.recordedAt).toISOString():null,
      ...Object.fromEntries(['seconds','input','cached','output','ttft','peakGpuMiB'].map(key=>[key,numeric(row[key])]))};
  })};
}

const disabled=()=>({agents:[],agentSource:{status:'not-connected'},localModel:{host:'Ubuntu',status:'not-connected'}});
// Transitional adapter for explicitly configured legacy sources. No discovery,
// credential transfer or new opt-in. Private paths never enter its result.
export async function collectLegacyWorkflows(runtime,{enabled={receipts:false,benchmarks:false},isEnabled=async()=>enabled,receipts=readAgentReceipts,benchmark=async(host,folder)=>
  pythonReport(host,await readFile(new URL('./read-local-model.py',import.meta.url),'utf8'),folder)}={}) {
  const result=disabled();
  const validate=value=>value && typeof value==='object' && !Array.isArray(value) &&
    Object.keys(value).length===2 && typeof value.receipts==='boolean' && typeof value.benchmarks==='boolean';
  if(!validate(enabled))throw Error('Explicit workflow switches required');
  if(!enabled.receipts && !enabled.benchmarks)return result;
  const file=path.join(runtime,'local.config.json');
  let config;
  try {
    const stat=await lstat(file);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.size>65536)throw Error('Invalid legacy configuration');
    config=JSON.parse(await readFile(file,'utf8'));
    if(!config || typeof config!=='object' || Array.isArray(config))throw Error('Invalid legacy configuration');
  } catch(error) {
    if(error.code==='ENOENT')return result;
    throw Error('Legacy workflow configuration unavailable');
  }
  const absolute=value=>typeof value==='string' && path.isAbsolute(value) && !/[\r\n\0]/.test(value);
  if(enabled.receipts && config.receiptDirectory!==undefined && !absolute(config.receiptDirectory))throw Error('Invalid receipt directory');
  if(enabled.benchmarks && config.localModelResults && (!absolute(config.localModelResults) || typeof config.ubuntuHost!=='string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(config.ubuntuHost)))throw Error('Invalid benchmark source');
  await Promise.all([
    enabled.receipts && config.receiptDirectory?Promise.resolve().then(()=>receipts(config.receiptDirectory)).then(value=>{
      result.agents=value.agents;result.agentSource=value.source;
    }).catch(()=>{result.agentSource={status:'unavailable'};}):null,
    enabled.benchmarks && config.localModelResults?Promise.resolve().then(()=>benchmark(config.ubuntuHost,config.localModelResults)).then(value=>{
      result.localModel=cleanLocalModel(value);
    }).catch(()=>{result.localModel={host:'Ubuntu',status:'unavailable'};}):null,
  ]);
  const current=await isEnabled();
  if(!validate(current))throw Error('Workflow switches unavailable');
  if(!current.receipts){result.agents=[];result.agentSource={status:'not-connected'};}
  if(!current.benchmarks)result.localModel={host:'Ubuntu',status:'not-connected'};
  return result;
}

export function attachWorkflows(result,workflows) {
  Object.assign(result.data,workflows);
  for(const source of [workflows.agentSource,workflows.localModel]) {
    if(source.status==='not-connected')continue;
    result.status.sourcesConfigured++;
    if(source.status==='ok')result.status.sourcesRead++;
  }
  result.status.state=result.status.sourcesConfigured>0 && result.status.sourcesRead===result.status.sourcesConfigured?'ok':'partial';
}
