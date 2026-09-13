import path from 'node:path';

// A Node parent can inherit PowerShell 7 module paths that Windows PowerShell
// cannot load. This child needs only Windows' built-in modules, not user modules.
export function windowsPowerShellEnvironment(environment=process.env) {
  const result=Object.fromEntries(Object.entries(environment).filter(([key])=>key.toLowerCase()!=='psmodulepath'));
  const systemRoot=Object.entries(environment).find(([key])=>key.toLowerCase()==='systemroot')?.[1] || 'C:/Windows';
  result.PSModulePath=path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','Modules');
  return result;
}
