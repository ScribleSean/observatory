import {sessionIdentity} from '../lib/same-repo.mjs';

// Fictional sessions for tests and the preview. No real folder, repository or branch is used.
const session=(host,engine,toplevel,branch,remote='https://example.invalid/studio/field-notes.git')=>
  ({engine,...sessionIdentity({host,toplevel,commonDir:'/fictional/field-notes/.git',remote,branch})});

export function syntheticSessions(kind='folder') {
  const other=session('Mac','claude','/fictional/other','main','https://example.invalid/studio/tide-tables.git');
  if(kind==='folder')return {Mac:[session('Mac','claude','/fictional/field-notes','main'),session('Mac','codex','/fictional/field-notes','main'),other],Windows:[]};
  if(kind==='branch')return {Mac:[session('Mac','claude','/fictional/field-notes','feature/search'),other],
    Windows:[session('Windows','codex','C:/fictional/field-notes','feature/search')]};
  return {Mac:[session('Mac','claude','/fictional/field-notes','main'),session('Mac','codex','/fictional/wt/field-notes-fix','codex/fix'),other],Windows:[]};
}
