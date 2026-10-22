import path from 'node:path';

// -ExecutionPolicy Bypass applies only to this child process. The app never calls
// Set-ExecutionPolicy. Group Policy (MachinePolicy or UserPolicy) still takes
// precedence, in which case a policy that blocks the script prevents it running.
export function windowsPowerShellFileArguments(script,...scriptArguments) {
  return ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,...scriptArguments];
}

// A Node parent can inherit PowerShell 7 module paths that Windows PowerShell
// cannot load.
export function windowsPowerShellEnvironment(environment=process.env) {
  const result=Object.fromEntries(Object.entries(environment).filter(([key])=>key.toLowerCase()!=='psmodulepath'));
  const systemRoot=Object.entries(environment).find(([key])=>key.toLowerCase()==='systemroot')?.[1] || 'C:/Windows';
  result.PSModulePath=path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','Modules');
  return result;
}
