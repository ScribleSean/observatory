import {readFileSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';

export function packageRoot(moduleId) {
  const id=moduleId.replace(/^\0/,'').replaceAll('\\','/');
  const marker='/node_modules/';
  const index=id.lastIndexOf(marker);
  if(index<0)return null;
  const parts=id.slice(index+marker.length).split('/');
  const name=parts[0].startsWith('@')?parts.slice(0,2).join('/'):parts[0];
  if(!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name))throw Error('Invalid bundled package name');
  return id.slice(0,index+marker.length)+name;
}

export function licenseText(roots) {
  const packages=new Map();
  for(const root of roots) {
    const info=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
    const names=readdirSync(root).filter(name=>/^(licen[cs]e|copying|notice)([._-].*)?$/i.test(name));
    const licenses=names.filter(name=>statSync(path.join(root,name)).isFile()).sort().map(name=>{
      const file=path.join(root,name);
      if(statSync(file).size>500_000)throw Error('License exceeds review limit');
      return `${name}\n${readFileSync(file,'utf8').trim()}`;
    });
    if(!licenses.length)throw Error(`No license text found for bundled package ${info.name}`);
    const name=`${info.name}@${info.version}`;
    packages.set(name,`${name}\nDeclared license: ${typeof info.license==='string'?info.license:'See included license text'}\n\n${licenses.join('\n\n')}`);
  }
  const text='Third-party software included in the dashboard bundle.\n\n'+[...packages].sort(([a],[b])=>a.localeCompare(b)).map(([,text])=>text).join('\n\n========================================\n\n')+'\n';
  if(Buffer.byteLength(text)>5_000_000)throw Error('Combined notices exceed review limit');
  return text;
}

export function webLicenses(root) {
  return {
    name:'observatory-web-licenses',
    generateBundle(_options,bundle) {
      const roots=new Set();
      for(const output of Object.values(bundle)) {
        if(output.type!=='chunk')continue;
        for(const [id,module] of Object.entries(output.modules)) {
          if(!module.renderedLength)continue;
          const owner=packageRoot(id);
          if(owner)roots.add(owner);
        }
      }
      // CSS imports are expanded before chunk attribution. Include them explicitly.
      for(const name of ['tailwindcss','tw-animate-css','shadcn'])roots.add(path.join(root,'node_modules',name));
      const fontLicense=readFileSync(path.join(root,'public/fonts/OFL.txt'),'utf8');
      this.emitFile({type:'asset',fileName:'assets/third-party-licenses.txt',source:licenseText(roots)+'\nInter Tight\n'+fontLicense});
    }
  };
}
