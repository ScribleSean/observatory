import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,cpSync,writeFileSync,readFileSync,readdirSync,rmSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {bundleRuntime} from './mac/runtime-bundle.mjs';
import {sourceState} from './source-state.mjs';
import {desktopReleaseVersion} from './release-version.mjs';
import {macUpdateConfiguration} from './mac/update-configuration.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const source=sourceState(root);
const release=desktopReleaseVersion();
const runtimeIndex=process.argv.indexOf('--runtime-dir');
const runtimeSource=runtimeIndex>=0?process.argv[runtimeIndex+1]:null;
if(!runtimeSource || !path.isAbsolute(runtimeSource))throw Error('Pass --runtime-dir with an absolute verified Mac runtime payload directory');
const updaterIndex=process.argv.indexOf('--updater-archive');
const updaterArchive=updaterIndex>=0?process.argv[updaterIndex+1]:null;
if(updaterIndex>=0 && (!updaterArchive || !path.isAbsolute(updaterArchive)))throw Error('Use an absolute pinned Sparkle archive path');
const keyIndex=process.argv.indexOf('--update-public-key');
if(keyIndex>=0 && !process.argv[keyIndex+1])throw Error('Pass a base64 Ed25519 public key');
const updateConfiguration=macUpdateConfiguration(keyIndex>=0?process.argv[keyIndex+1]:undefined,
  {hasFramework:!!updaterArchive});
const output=path.join(root,'.native-build');
const webIndex=process.argv.indexOf('--web-dir');
const webSource=webIndex>=0?process.argv[webIndex+1]:path.join(output,'web');
if(!webSource || !path.isAbsolute(webSource))throw Error('Use an absolute web bundle directory');
mkdirSync(output,{recursive:true});
if (process.argv.includes('--native-only') || webIndex>=0) {
  // Explicit opt-in for Swift-only edits. The packaged web smoke test still runs.
  if (!existsSync(path.join(webSource,'index.html'))) throw Error('Build the web bundle first');
  console.log('Reusing the existing web bundle for a native-only change.');
} else {
  execFileSync(path.join(root,'node_modules/.bin/vite'),['build','--config','native/vite.config.mts'],{cwd:root,stdio:'inherit'});
}
// Build app bundles outside file-provider-managed project folders.
const staging=mkdtempSync(path.join(tmpdir(),'observatory-build-'));
const bundle=path.join(staging,'Workspace Observatory.app');
const contents=path.join(bundle,'Contents');
const resources=path.join(contents,'Resources');
mkdirSync(path.join(contents,'MacOS'),{recursive:true});
mkdirSync(resources,{recursive:true});
cpSync(path.join(root,'public/fonts/InterTight.ttf'),path.join(resources,'InterTight.ttf'));
cpSync(path.join(root,'public/fonts/OFL.txt'),path.join(resources,'InterTight-OFL.txt'));
for(const name of ['LICENSE','THIRD-PARTY-NOTICES.md'])cpSync(path.join(root,name),path.join(resources,name));
writeFileSync(path.join(resources,'build-info.json'),JSON.stringify({...release,sourceRevision:source.revision,sourceDirty:source.dirty,
  ...(updaterArchive?{updaterVersion:JSON.parse(readFileSync(path.join(root,'native/mac/updater-tool.json'),'utf8')).version}:{})}));
const runtimeBinaries=bundleRuntime(runtimeSource,path.join(resources,'Runtime'),
  JSON.parse(readFileSync(path.join(root,'native/mac/runtime-assets.json'),'utf8')));
const mark=path.join(root,'public/brand/telescope.svg');
cpSync(mark,path.join(resources,'telescope.svg'));
const iconset=path.join(staging,'AppIcon.iconset');
execFileSync('/usr/bin/xcrun',['swift','-module-cache-path',path.join(output,'module-cache'),
  path.join(root,'native/tools/build-icons.swift'),mark,iconset],{stdio:'inherit'});
execFileSync('/usr/bin/iconutil',['-c','icns',iconset,'-o',path.join(resources,'AppIcon.icns')],{stdio:'inherit'});
const web=path.join(resources,'Web');
if(existsSync(web))rmSync(web,{recursive:true});
cpSync(webSource,web,{recursive:true});
if(existsSync(path.join(web,'local')))throw Error('Private snapshots must never enter the app bundle');
if(!existsSync(path.join(web,'assets/third-party-licenses.txt')))throw Error('Web dependency notices must be included');
const scripts=path.join(resources,'Collector','scripts');
mkdirSync(scripts,{recursive:true});
for(const name of readdirSync(path.join(root,'scripts'))) {
  if(name.endsWith('.test.mjs') || !/\.(mjs|py|ps1)$/.test(name))continue;
  cpSync(path.join(root,'scripts',name),path.join(scripts,name));
}
const sources=readdirSync(path.join(root,'native')).filter(name=>name.endsWith('.swift')).map(name=>path.join(root,'native',name));
const updaterLink=[];
if(updaterArchive) {
  const prepared=path.join(staging,'updater');
  execFileSync('/usr/bin/python3',[path.join(root,'native/mac/prepare-updater.py'),
    '--archive',updaterArchive,'--output',prepared],{stdio:'inherit',timeout:60000});
  const frameworks=path.join(contents,'Frameworks');
  mkdirSync(frameworks);
  const framework=path.join(frameworks,'Sparkle.framework');
  cpSync(path.join(prepared,'Sparkle.framework'),framework,{recursive:true,verbatimSymlinks:true});
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',framework],{stdio:'inherit',timeout:30000});
  cpSync(path.join(prepared,'LICENSE'),path.join(resources,'Sparkle-LICENSE.txt'));
  updaterLink.push('-F',frameworks,'-framework','Sparkle','-Xlinker','-rpath',
    '-Xlinker','@executable_path/../Frameworks');
}
const binary=path.join(contents,'MacOS','WorkspaceObservatory');
execFileSync('/usr/bin/xcrun',['swiftc','-swift-version','5','-O','-module-cache-path',path.join(output,'module-cache'),
  '-target','arm64-apple-macosx14.0','-framework','AppKit','-framework','SwiftUI','-framework','WebKit',
  '-framework','ServiceManagement',...updaterLink,...sources,'-o',binary],{cwd:root,stdio:'inherit'});
writeFileSync(path.join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>io.workspace-observatory.app</string>
<key>CFBundleName</key><string>Observatory</string>
<key>CFBundleDisplayName</key><string>Observatory</string>
<key>CFBundleExecutable</key><string>WorkspaceObservatory</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundleShortVersionString</key><string>${release.version}</string>
<key>CFBundleVersion</key><string>${release.buildNumber}</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><false/>
<key>NSHighResolutionCapable</key><true/>
${updateConfiguration}
</dict></plist>\n`);
// Remove Finder metadata only from this generated bundle before local signing.
for (const attribute of ['com.apple.FinderInfo','com.apple.ResourceFork']) {
  spawnSync('/usr/bin/xattr',['-rd',attribute,bundle],{stdio:'ignore'});
}
execFileSync('/usr/bin/codesign',['--force','--sign','-','--timestamp=none',bundle],{stdio:'inherit'});
execFileSync(binary,['--self-test'],{stdio:'inherit'});
execFileSync(binary,['--test-quota-archive'],{stdio:'inherit',timeout:60000});
execFileSync(binary,['--test-trusted-sync-owner',path.join(resources,'Runtime/node/bin/node'),
  path.join(scripts,'peer-tls-service.mjs')],{stdio:'inherit',timeout:30000});
execFileSync(binary,['--test-shutdown'],{stdio:'inherit',timeout:15000});
execFileSync(binary,['--test-collector'],{stdio:'inherit',timeout:30000});
execFileSync('/usr/bin/codesign',['--verify','--strict',bundle],{stdio:'inherit'});
execFileSync(binary,['--test-web'],{stdio:'inherit',timeout:35000});
execFileSync(binary,['--test-lifecycle'],{stdio:'inherit',timeout:20000});
execFileSync(binary,['--test-popup'],{stdio:'inherit',timeout:15000});
execFileSync(binary,['--test-popup','--force-offscreen-popup'],{stdio:'inherit',timeout:15000});
execFileSync(binary,['--test-lifecycle','--legacy-dashboard'],{stdio:'inherit',timeout:20000});
execFileSync(binary,['--test-popup','--legacy-dashboard'],{stdio:'inherit',timeout:15000});
writeFileSync(path.join(output,'app.json'),JSON.stringify({bundle,builtAt:new Date().toISOString(),sourceRevision:source.revision,sourceDirty:source.dirty}));
console.log(`Built ${bundle} (native binary ${(statSync(binary).size/1048576).toFixed(1)} MiB, ${runtimeBinaries} signed runtime binaries). No live data bundled.`);
