import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cleanSettings, cleanTokens, cleanActivity, guarded } from './snapshot-clean.mjs';
import { macActivity } from './mac-activity.mjs';
import { collectLegacyQuota } from './legacy-quota.mjs';
import { pythonReport } from './python-report.mjs';
import { readSettingsSnapshot } from './settings-snapshot.mjs';
import { combineTokens, combineSettings } from './combine-tokens.mjs';
import { combineActivity } from './combine-activity.mjs';
import { randomBytes } from 'node:crypto';
import { powershellCommand } from './powershell-command.mjs';
import { homedir } from 'node:os';
import { cleanWispr } from './wispr.mjs';
import { readBoundedReceipts as readAgentReceipts } from './bounded-receipts.mjs';
export { cleanReceipts } from './agent-receipts.mjs';
import {retainActivityHistory} from './activity-history.mjs';
import {retirementSnapshotGuard} from './mac-snapshot-archive.mjs';
import {cachedSettingsScript} from './cached-settings.mjs';
const exec = promisify(execFile);
const assetRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeOverride = process.env.OBSERVATORY_RUNTIME;
if (runtimeOverride !== undefined && !path.isAbsolute(runtimeOverride))
  throw Error('Absolute runtime path required');
const root = runtimeOverride ?? assetRoot;
async function command(file, args) {
  const { stdout } = await exec(file, args, {
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}
export async function collect() {
  const replacement=await retirementSnapshotGuard(root);
  const previousHistory=replacement.history;
  const config = JSON.parse(
    await readFile(path.join(root, 'local.config.json'), 'utf8'),
  );
  for (const key of ['macCcusage'])
    if (!/^\/[a-zA-Z0-9_./-]+$/.test(config[key]))
      throw Error('Invalid configured executable');
  if (config.codexExecutable && !/^\/[a-zA-Z0-9_./-]+$/.test(config.codexExecutable)) throw Error('Invalid Codex executable');
  if (config.windowsCodexHome && !/^\/mnt\/[a-z]\/[a-zA-Z0-9_./-]+$/.test(config.windowsCodexHome))
    throw Error('Invalid Windows log directory');
  for (const key of ['windowsHost'])
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(config[key]))
      throw Error('Invalid SSH alias');
  if (
    typeof config.receiptDirectory !== 'string' ||
    !path.isAbsolute(config.receiptDirectory)
  )
    throw Error('Invalid receipt directory');
  const ps = await readFile(
    path.join(assetRoot, 'scripts/windows-aggregate-activity.ps1'),
    'utf8',
  );
  const readTokens = host => guarded(host, async () => {
    if (host === 'Mac') return cleanTokens(await command(config.macCcusage,
      ['codex','daily','--offline','--no-cost','--timezone','America/New_York','--json']),host);
    // Windows saved logs now come only from its native collector and pairing.
    // A legacy mount path never authorizes a read through Ubuntu.
    return {host,status:'not-connected'};
  });
  const [mac, windows, macTokens, windowsTokens, quota] = await Promise.all([
    guarded('Mac', macActivity),
    guarded('Windows', async () =>
      cleanActivity(
        await command('ssh', [
          '-oBatchMode=yes',
          '-oConnectTimeout=8',
          config.windowsHost,
          powershellCommand(ps),
        ]),
        'Windows',
      ),
    ),
    readTokens('Mac'),
    readTokens('Windows'),
    guarded('Codex', () => collectLegacyQuota(root)),
  ]);
  // Comparison keys change every collection and never enter the saved report.
  const settingsScript = `INVENTORY_SALT = '${randomBytes(32).toString('hex')}'\n` + await readFile(path.join(assetRoot,'scripts/read-settings.py'),'utf8');
  const inventories = {};
  const tokenSources = [macTokens, windowsTokens];
  const settings = await Promise.all([
    ['Mac',null,config.macCodexHome], ['Windows',null,null]
  ].map(([host,ssh,folder],index)=>folder?guarded(host,async()=>{
    const result = await readSettingsSnapshot(tokenSources[index], () => readTokens(host),
      async () => {
        const script=host==='Mac' ? await cachedSettingsScript(root,settingsScript) : settingsScript;
        const raw = await pythonReport(ssh,script,folder);
        inventories[host] = raw.inventory;
        return cleanSettings(raw,host);
      });
    if (result.tokens.status === 'ok') tokenSources[index] = result.tokens;
    else inventories[host] = {status:'incomplete'};
    return result.settings;
  }):Promise.resolve({host,status:'not-connected'})));
  const receipts = await readAgentReceipts(config.receiptDirectory);
  const wisprScript = await readFile(path.join(assetRoot,'scripts/read-wispr.py'),'utf8');
  const dictation = await Promise.all(['Mac','Windows'].map(async host => {
    const source='Wispr Flow';
    const enabled = config.dictation?.[host.toLowerCase()] === true;
    if (!enabled || (host === 'Windows' && !config.windowsCodexHome)) return {host,source,status:'not-connected'};
    const nativeWindows = host === 'Windows';
    const result = await guarded(host,async () => cleanWispr(await pythonReport(
      host === 'Mac' ? null : config.windowsHost,
      `MODE = '${host.toLowerCase()}'\n` + wisprScript,
      host === 'Mac' ? homedir() : path.posix.dirname(config.windowsCodexHome),
      {nativeWindows},
    ),host));
    return {...result,source};
  }));
  const combined = combineActivity([mac, windows]);
  const combinedTokens = combineTokens(tokenSources,inventories,['Mac','Windows']);
  const data = {
    schema: 2,
    collectedAt: new Date().toISOString(),
    timezone: 'America/New_York',
    activity: [mac, windows].map(({ intervals, trackingIntervals, ...safe }) => safe),
    combined,
    tokens: tokenSources,
    combinedTokens,
    combinedSettings: combinedTokens.status === 'ok' ? combineSettings(tokenSources,settings) : {host:'All',status:'unavailable'},
    agents: receipts.agents,
    agentSource: receipts.source,
    quota,
    localModel:{host:'Ubuntu',status:'not-connected'},
    dictation,
    settings,
  };
  data.activityHistory=retainActivityHistory(previousHistory,[combined,...data.activity],data.collectedAt);
  const folder = path.join(root, 'public/local');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const target = path.join(folder, 'usage.json');
  const temporary=path.join(folder,`.collector-${randomBytes(16).toString('hex')}.tmp`);
  try {
    await writeFile(temporary,JSON.stringify(data),{flag:'wx',mode:0o600,flush:true});
    await replacement.preserve();
    await rename(temporary,target);
  } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  console.log(
    JSON.stringify({
      collectedAt: data.collectedAt,
      sources: [...data.activity, ...data.tokens].map((x) => ({
        host: x.host,
        status: x.status,
      })),
      agentSnapshots: data.agents.length,
    }),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await collect();
