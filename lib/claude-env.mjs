// The whole environment Observatory gives a Claude Code process: the limits read, `claude auth status`, the sign-in
// and the check all start claude with claudeEnvironment() and nothing else.
//
// A collector started from another Claude session inherits that session's variables, and passing them on made the
// command hang, so only a short fixed list is kept. The menu bar and tray apps are started at login, not from a shell,
// so they lack variables the user set in their shell profile. A network that inspects TLS with its own certificate
// authority needs one of those: claude reads extra trusted certificates from NODE_EXTRA_CA_CERTS only, so sign-in and
// token renewal fail without it. Setup, run from the user's shell, records that certificate file in the user's own
// settings file (claude.caCertificates), and every claude process gets it from there when its own environment lacks it.
// CLAUDE_CODE_CERT_STORE, which picks the certificate store claude starts from, travels the same way
// (claude.certStore). Observatory never chooses a value for either: it passes on what the user already set.
import {closeSync,openSync,readSync,statSync} from 'node:fs';
import path from 'node:path';

// The variables that tell claude which certificates to trust: the extra certificate file and the certificate store.
// Only this list, with the values recorded at setup, passes them on.
export const CA_VARIABLES=Object.freeze(['NODE_EXTRA_CA_CERTS','CLAUDE_CODE_CERT_STORE']);
// The certificate stores Observatory passes on. Any other name is left out.
export const CERT_STORES=Object.freeze(['system','bundled']);

// CLAUDE_CODE_CERT_STORE as Claude Code reads it: a list of store names separated by commas, in any letter case and
// with spaces around them. The known names, each once and in the order given ("bundled,system"), or null.
export function certStoreValue(value) {
  if(typeof value!=='string')return null;
  const names=[...new Set(value.split(',').map(name=>name.trim().toLowerCase()).filter(name=>CERT_STORES.includes(name)))];
  return names.length?names.join(','):null;
}
// Where setup looks for the user's certificate file, in order: the variable claude reads, then the one OpenSSL reads.
export const CA_SHELL_SOURCES=Object.freeze(['NODE_EXTRA_CA_CERTS','SSL_CERT_FILE']);

const KEEP=Object.freeze({
  posix:Object.freeze(['HOME','USER','LOGNAME','SHELL','PATH','TMPDIR','LANG','LC_ALL','CLAUDE_CONFIG_DIR']),
  win32:Object.freeze(['SystemRoot','SystemDrive','USERPROFILE','HOMEDRIVE','HOMEPATH','USERNAME','APPDATA','LOCALAPPDATA','TEMP','TMP','PATH','Path','PATHEXT','COMSPEC','CLAUDE_CONFIG_DIR']),
});

// Every variable claude may get from Observatory.
export const claudeVariables=(platform=process.platform)=>[...(platform==='win32'?KEEP.win32:KEEP.posix),...CA_VARIABLES];

const MAX_BUNDLE=16*1024*1024;

// An absolute path to a readable file that holds at least one PEM certificate. Only the start of the file is read,
// to tell a certificate bundle from something else. Nothing of it is kept or shown.
export function certificateFile(file,platform=process.platform) {
  // oxlint-disable-next-line no-control-regex -- refusing control characters is the point
  if(typeof file!=='string' || !file || /[\u0000-\u001f]/.test(file) || !(platform==='win32'?path.win32:path.posix).isAbsolute(file))return false;
  let handle=null;
  try {
    const info=statSync(file);
    if(!info.isFile() || info.size===0 || info.size>MAX_BUNDLE)return false;
    handle=openSync(file,'r');
    const buffer=Buffer.alloc(Math.min(info.size,256*1024));
    const read=readSync(handle,buffer,0,buffer.length,0);
    return buffer.toString('latin1',0,read).includes('-----BEGIN CERTIFICATE-----');
  } catch {return false;}
  finally {if(handle!==null)try {closeSync(handle);}catch {}}
}

// The certificate file the user's shell points at, for setup to record. Null when there is none.
export function shellCertificateFile(source=process.env,platform=process.platform) {
  for(const name of CA_SHELL_SOURCES)if(certificateFile(source[name],platform))return source[name];
  return null;
}

/**
 * The certificate file claude gets: its own environment's NODE_EXTRA_CA_CERTS first, else the file recorded at setup
 * while it is still there.
 * @returns {{file: string | null, from: 'environment' | 'settings' | null, missing: boolean}} missing: a file was
 *   recorded at setup and is gone or unreadable now.
 */
export function certificateSource(config,source=process.env,platform=process.platform) {
  const own=source?.NODE_EXTRA_CA_CERTS;
  if(typeof own==='string' && own)return {file:own,from:'environment',missing:false};
  const recorded=config?.claude?.caCertificates;
  if(typeof recorded!=='string' || !recorded)return {file:null,from:null,missing:false};
  return certificateFile(recorded,platform)?{file:recorded,from:'settings',missing:false}:{file:null,from:null,missing:true};
}

// The certificate store claude gets: its own environment's CLAUDE_CODE_CERT_STORE first, else the one recorded at
// setup. Null when the user set none.
export function certificateStore(config,source=process.env) {
  return certStoreValue(source?.CLAUDE_CODE_CERT_STORE) ?? certStoreValue(config?.claude?.certStore);
}

// What the "env" block of Claude Code's own settings file sets for these variables, for setup to record. Claude Code
// does not load that file when Observatory starts it, so setup reads the two values. Nothing else of the file is kept.
export function settingsCertificates(settings,platform=process.platform) {
  const env=settings && typeof settings==='object' && settings.env && typeof settings.env==='object' && !Array.isArray(settings.env)?settings.env:{};
  return {file:certificateFile(env.NODE_EXTRA_CA_CERTS,platform)?env.NODE_EXTRA_CA_CERTS:null,
    store:certStoreValue(env.CLAUDE_CODE_CERT_STORE)};
}

// The environment for every claude process Observatory starts.
export function claudeEnvironment(config,source=process.env,platform=process.platform) {
  const result={};
  for(const name of platform==='win32'?KEEP.win32:KEEP.posix)if(typeof source[name]==='string')result[name]=source[name];
  const {file}=certificateSource(config,source,platform);
  const values={NODE_EXTRA_CA_CERTS:file,CLAUDE_CODE_CERT_STORE:certificateStore(config,source)};
  for(const name of CA_VARIABLES)if(values[name])result[name]=values[name];
  return result;
}
