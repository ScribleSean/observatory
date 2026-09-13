import {readFileSync,readdirSync,lstatSync,readlinkSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {forbiddenPackageName,containsBuildPath} from '../windows/package-content.mjs';

export function inspectMacPackage(bundle,{revision,buildRoots=[],allowRelocatedBundle=false}={}) {
  const root=realpathSync(bundle);
  if((!allowRelocatedBundle && path.basename(root)!=='Workspace Observatory.app') || !lstatSync(root).isDirectory())throw Error('Expected the Observatory app bundle');
  const info=JSON.parse(readFileSync(path.join(root,'Contents/Resources/build-info.json'),'utf8'));
  if(info.sourceDirty!==false || !/^[a-f0-9]{40}$/.test(info.sourceRevision) ||
    (revision && info.sourceRevision!==revision) || !/^\d+\.\d+\.\d+$/.test(info.version))throw Error('A matching clean-source app build is required');
  const files=[],symlinks=[];
  let bytes=0;
  function walk(directory) {
    for(const name of readdirSync(directory).sort()) {
      if(forbiddenPackageName(name) || name==='.DS_Store' || name.startsWith('._') || /[\x00-\x1f\x7f]/.test(name))throw Error('Private or unsafe package filename');
      const file=path.join(directory,name),relative=path.relative(root,file).split(path.sep).join('/');
      const stat=lstatSync(file);
      if(stat.isSymbolicLink()) {
        const target=readlinkSync(file),resolved=realpathSync(file);
        if(path.isAbsolute(target) || !resolved.startsWith(root+path.sep))throw Error('App symlink escapes its bundle');
        symlinks.push({path:relative,target});
      } else if(stat.isDirectory())walk(file);
      else if(stat.isFile()) {
        const data=readFileSync(file);
        if(containsBuildPath(data,buildRoots))throw Error(`Build path detected in ${relative}`);
        files.push({path:relative,bytes:data.length,mode:stat.mode&0o777,sha256:createHash('sha256').update(data).digest('hex')});
        bytes+=data.length;
      } else throw Error('Unsupported app file type');
    }
  }
  walk(root);
  const names=new Set(files.map(file=>file.path));
  for(const required of ['Contents/MacOS/WorkspaceObservatory','Contents/Info.plist',
    'Contents/Resources/LICENSE','Contents/Resources/THIRD-PARTY-NOTICES.md',
    'Contents/Resources/Web/index.html','Contents/Resources/Web/assets/third-party-licenses.txt',
    'Contents/Resources/Runtime/node/bin/node','Contents/Resources/Runtime/node/LICENSE',
    'Contents/Resources/Runtime/python/bin/python3.13','Contents/Resources/Runtime/python/licenses/LICENSE.cpython.txt',
    'Contents/Resources/Collector/scripts/run-collector.py','Contents/Resources/Collector/scripts/collect-mac.mjs',
    'Contents/_CodeSignature/CodeResources']) {
    if(!names.has(required))throw Error(`Required package file missing: ${required}`);
  }
  return {schema:1,platform:'macos-arm64',version:info.version,sourceRevision:info.sourceRevision,
    sourceDirty:false,signing:'ad-hoc, not notarized',fileCount:files.length,bytes,files,symlinks};
}

export function verifyMacPackage(bundle,manifest,options={}) {
  const actual=inspectMacPackage(bundle,{...options,revision:manifest.sourceRevision});
  if(JSON.stringify(actual)!==JSON.stringify(manifest))throw Error('App content does not match its package manifest');
  return actual;
}
