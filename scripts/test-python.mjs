import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Never use the Windows Store python3 alias.
export function pythonTestCommand(args,env=process.env,platform=process.platform) {
  const override=env.OBSERVATORY_TEST_PYTHON;
  if(override!==undefined && (typeof override!=='string' ||
    !(platform==='win32'?path.win32:path.posix).isAbsolute(override)))
    throw Error('OBSERVATORY_TEST_PYTHON must be an absolute executable path');
  return {executable:override || (platform==='win32'?path.win32.join(env.SystemRoot || 'C:/Windows','py.exe'):'python3'),
    args:[...(platform==='win32'&&!override?['-3']:[]),'-B','-X','utf8',...args]};
}
export function execPython(args,options) {
  const command=pythonTestCommand(args);
  return execFileSync(command.executable,command.args,
    {cwd:fileURLToPath(new URL('../',import.meta.url)),...options});
}
