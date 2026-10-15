import {readFileSync} from 'node:fs';

const groups={
  "visible": [
    "productName",
    "macBundle",
    "artifactPrefix",
    "dataFolder",
    "windowsTestName",
    "publisher"
  ],
  "legacy": [
    "productName",
    "macBundle",
    "artifactPrefix",
    "dataFolder",
    "windowsTestName"
  ],
  "internal": [
    "macBundleIdentifier",
    "macExecutable",
    "macActivityWatchLabel",
    "windowsExecutable",
    "windowsAssembly",
    "windowsPackageFolder",
    "windowsBuildCache",
    "windowsSetupId",
    "windowsTestSetupId",
    "windowsAppId",
    "windowsTestAppId",
    "windowsStartupName",
    "windowsTestStartupName",
    "receiptProduct",
    "receiptDomain"
  ]
};

function exactKeys(value,keys) {
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    Reflect.ownKeys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
}

export function validateAppNames(value) {
  try {
    if(!exactKeys(value,['schema',...Object.keys(groups)]) || value.schema!==1)throw Error();
    for(const [group,keys] of Object.entries(groups)) {
      if(!exactKeys(value[group],keys))throw Error();
      for(const key of keys) {
        const name=value[group][key];
        if(typeof name!=='string' || !name.trim() || name.length>80 ||
          Array.from({length:name.length},(_,i)=>name.charCodeAt(i)).some(code=>code===0x2f || code===0x5c || code<0x20 || (code>=0x7f && code<=0x9f)) || name.includes('..'))throw Error();
      }
    }
    if(value.visible.macBundle!==value.visible.productName+'.app')throw Error();
    return value;
  } catch {
    throw Error('Invalid app names');
  }
}

function loadAppNames() {
  try {
    const value=validateAppNames(JSON.parse(readFileSync(new URL('app-names.json',import.meta.url),'utf8')));
    for(const group of Object.keys(groups))Object.freeze(value[group]);
    return Object.freeze(value);
  } catch {
    throw Error('Invalid app names');
  }
}

export const appNames=loadAppNames();
