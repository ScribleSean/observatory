import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {appNames,validateAppNames} from '../native/app-names.mjs';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const clone=()=>structuredClone(appNames);
const invalid=value=>assert.throws(()=>validateAppNames(value),{message:'Invalid app names'});

test('checked-in names validate and are deeply frozen',()=>{
  assert.deepEqual(validateAppNames(JSON.parse(read('native/app-names.json'))),appNames);
  assert.ok(Object.isFrozen(appNames));
  for(const group of ['visible','legacy','internal'])assert.ok(Object.isFrozen(appNames[group]));
  assert.throws(()=>{appNames.visible.productName='Changed';},TypeError);
});

test('invalid root, groups, keys and names are rejected',()=>{
  for(const value of [null,undefined,[],true,1,'names',{},new Date()])invalid(value);
  for(const schema of [undefined,null,'1',0,2,NaN])invalid({...clone(),schema});
  for(const key of Object.keys(appNames)) {
    const value=clone();delete value[key];invalid(value);
  }
  invalid({...clone(),extra:'extra'});
  for(const group of ['visible','legacy','internal']) {
    for(const value of [null,[],1,'names',{}])invalid({...clone(),[group]:value});
    const extra=clone();extra[group].extra='extra';invalid(extra);
    const symbol=clone();symbol[group][Symbol('extra')]='extra';invalid(symbol);
    for(const key of Object.keys(appNames[group])) {
      const missing=clone();delete missing[group][key];invalid(missing);
      for(const name of [null,undefined,1,true,{},[], '', ' ', 'x'.repeat(81),'a/b','a\\b','..', 'a..b', 'a"b', "a'b", 'a$b', 'a;b', 'café',
        ...Array.from({length:32},(_,i)=>'a'+String.fromCharCode(i)),
        ...Array.from({length:33},(_,i)=>'a'+String.fromCharCode(127+i))]) {
        const value=clone();value[group][key]=name;invalid(value);
      }
    }
  }
  const wrong=clone();wrong.visible.macBundle='Other.app';invalid(wrong);
  const inherited=Object.create(clone());invalid(inherited);
  const boundary=clone();boundary.visible.publisher='x'.repeat(80);validateAppNames(boundary);
});

test('native literal data paths and test names match shared names',()=>{
  const swift=[...read('native/main.swift').matchAll(/"Library\/Application Support\/([^"\n]+)"/g)];
  assert.equal(swift.length,2);
  for(const match of swift)assert.equal(match[1],appNames.visible.dataFolder);
  const identity=read('native/windows/AppIdentity.cs');
  assert.equal(identity.match(/TestName = "([^"]+)"/)[1],appNames.visible.windowsTestName);
  assert.equal(identity.match(/DataName => IsTest \? TestName : "([^"]+)"/)[1],appNames.visible.dataFolder);
});

test('bundle identifier template uses the unchanged internal identifier',()=>{
  const template=read('native/build.mjs').match(/<key>CFBundleIdentifier<\/key><string>([^<]+)<\/string>/)[1];
  assert.equal(template,'${appNames.internal.macBundleIdentifier}');
  assert.equal(template.replace('${appNames.internal.macBundleIdentifier}',appNames.internal.macBundleIdentifier),'io.workspace-observatory.app');
});

test('retired literals have explicit reported exceptions',t=>{
  const pattern=/Workspace Observatory\.app|Workspace-Observatory-|Application Support\/Workspace Observatory|['"]Workspace Observatory['"]/g;
  function allowed(file,line) {
    if(file==='native/app-names.json' || file.endsWith('.test.mjs') || file.endsWith('Tests.swift') || file.includes('/tests/'))return true;
    if(['native/windows/package.ps1','.github/workflows/windows-package.yml'].includes(file))
      return /\$app = Join-Path .* 'Workspace Observatory'/.test(line);
    if(file==='native/windows/retain-candidate.mjs')return /appNames\.internal\.windowsPackageFolder/.test(line);
    if(file==='native/windows/signed-receipt.mjs')return /const domain=/.test(line);
    if(file==='native/windows/AppIdentity.cs')return /Legacy(Data|Test)Name/.test(line);
    if(file==='native/main.swift')return /let legacyDataFolder =/.test(line);
    if(['native/mac/migrate-data.mjs','native/windows/migrate-data.ps1','scripts/peer-transport-rename.mjs'].includes(file))
      return /legacy|Legacy/.test(line);
    return false;
  }
  function scan(directory) {
    for(const entry of readdirSync(new URL('../'+directory+'/',import.meta.url),{withFileTypes:true})) {
      const file=directory+'/'+entry.name;
      if(entry.isDirectory()) {scan(file);continue;}
      if(!entry.isFile())continue;
      read(file).split('\n').forEach((line,index)=>{
        for(const match of line.matchAll(pattern)) {
          assert.ok(allowed(file,line),`${file}:${index+1}: ${match[0]}`);
          t.diagnostic(`Allowed retired literal ${file}:${index+1}: ${match[0]}`);
        }
      });
    }
  }
  scan('native');scan('scripts');scan('.github/workflows');
});

test('all internal identifiers retain their original values',()=>{
  assert.deepEqual(appNames.internal,{
  "macBundleIdentifier": "io.workspace-observatory.app",
  "macExecutable": "WorkspaceObservatory",
  "macActivityWatchLabel": "io.workspace-observatory.activitywatch",
  "windowsExecutable": "WorkspaceObservatory.exe",
  "windowsAssembly": "WorkspaceObservatory",
  "windowsPackageFolder": "Workspace Observatory",
  "windowsBuildCache": "WorkspaceObservatoryBuild",
  "windowsSetupId": "WorkspaceObservatorySetup",
  "windowsTestSetupId": "WorkspaceObservatoryInstallerTest",
  "windowsAppId": "WorkspaceObservatory",
  "windowsTestAppId": "WorkspaceObservatoryInstallerTest.App",
  "windowsStartupName": "WorkspaceObservatory",
  "windowsTestStartupName": "WorkspaceObservatoryInstallerTest",
  "receiptProduct": "WorkspaceObservatorySetup",
  "receiptDomain": "Workspace Observatory Windows installation receipt v1"
});
});

test('packaged updater scripts stay self-contained and match the internal receipt names',()=>{
  // These two updater scripts ship under Updater/ in the Windows package, so they keep literals.
  const project=read('native/windows/WorkspaceObservatory.csproj');
  assert.match(project, /<Link>Updater\/%\(Filename\)%\(Extension\)<\/Link>/, 'The two updater scripts ship under Updater/');
  const shipped=project.match(/<Content Include="([^"]+)">/)[1].split(';');
  assert.ok(shipped.includes('signed-receipt.mjs') && shipped.includes('verify-installation.mjs'));
  for(const name of shipped)assert.doesNotMatch(read('native/windows/'+name),/app-names/,name);
  assert.ok(read('native/windows/signed-receipt.mjs').includes(`const domain='${appNames.internal.receiptDomain}\\n';`));
  assert.ok(read('native/windows/signed-receipt.mjs').includes(`receipt.product!=='${appNames.internal.receiptProduct}'`));
  assert.ok(read('native/windows/verify-installation.mjs').includes(`lines[1]!=='Product=${appNames.internal.receiptProduct}'`));
});
