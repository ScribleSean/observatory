// Two live agent sessions in one repository can overwrite each other's files. This module only
// compares session records that each computer already collected. It never reads a prompt or
// touches an agent. A session record holds the engine, a short id for the repository and for the
// checkout folder, the repository name and the branch. It holds no path, argument or prompt.
import {createHash} from 'node:crypto';
import path from 'node:path';
import strings from './strings.json' with {type: 'json'};
import {format} from './format.mjs';

export const ENGINE_NAMES = {claude: 'Claude', codex: 'Codex'};
export const MAX_SESSIONS = 40;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const short = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
const ID = /^[0-9a-f]{12}$/;
// Control characters in a name or branch are dropped, so a hostile record cannot break the line.
const printable = text => [...text].filter(char => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127).join('');
// A repository name or branch is letters and digits in any script and a few joining marks. Anything else,
// such as text that looks like a sentence or a path, is dropped, so a bad record cannot carry a message through.
const NAME = /^[\p{L}\p{N}_.@+\-/ ]+$/u;
const clip = (value, length) => {
  if (typeof value !== 'string') return '';
  const text = printable(value).trim().slice(0, length);
  return NAME.test(text) && !text.includes('..') && !text.startsWith('/') ? text : '';
};

// One name for a remote however it was cloned, so the Mac and the PC agree: https or ssh form,
// credentials, a trailing .git and letter case do not matter.
export function normalizeRemote(url) {
  if (typeof url !== 'string') return null;
  let text = url.trim();
  if (!text) return null;
  // Scheme, then user, then a port, then the colon of the short ssh form.
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@/]*@/, '').replace(/^([^/:]+):\d+\//, '$1/').replace(/^([^/:]+):/, '$1/');
  text = text.replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
  return text || null;
}

// Identity for one process, from facts the reader got from git. A worktree and the main checkout
// share a common git directory and a remote, so they read as one repository.
export function sessionIdentity({host, toplevel, commonDir, remote, branch}) {
  const normal = normalizeRemote(remote);
  const root = commonDir.replace(/[\\/]+$/, '');
  const name = normal ? normal.split('/').pop() : path.basename(path.basename(root) === '.git' ? path.dirname(root) : root);
  return {repoId: short(normal ? `remote:${normal}` : `local:${host}:${root}`),
    repo: clip(name, 64) || strings.sameRepo.unknownRepo, checkoutId: short(`checkout:${host}:${toplevel}`),
    // The id compares branches exactly, whatever characters git allowed. The name is only for reading.
    branchId: branch ? short(`branch:${branch}`) : null, branch: clip(branch, 80) || null};
}

// A record from another computer is untrusted, so rebuild it field by field.
export function cleanSessions(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(object).filter(row => Object.hasOwn(ENGINE_NAMES, row.engine) && ID.test(row.repoId) && ID.test(row.checkoutId))
    .slice(0, MAX_SESSIONS).map(row => ({engine: row.engine, repoId: row.repoId, repo: clip(row.repo, 64) || strings.sameRepo.unknownRepo,
      checkoutId: row.checkoutId, branchId: ID.test(row.branchId) ? row.branchId : null, branch: clip(row.branch, 80) || null}));
}

const RANK = {folder: 3, branch: 2, repo: 1};

// How close two sessions are: the same folder (they write the same files), the same branch name
// in two places (they will conflict on push), or only the same repository.
function closeness(a, b) {
  if (a.host === b.host && a.checkoutId === b.checkoutId) return 'folder';
  if (a.branchId !== null && a.branchId === b.branchId) return 'branch';
  return 'repo';
}

// sessions: [{host, engine, repoId, repo, checkoutId, branchId, branch}]. Returns one entry for each
// repository with two or more sessions, the closest pair first.
export function findCollisions(sessions) {
  const groups = new Map();
  for (const session of sessions) groups.set(session.repoId, [...groups.get(session.repoId) ?? [], session]);
  const found = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    let same = 'repo';
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const level = closeness(group[i], group[j]);
      if (RANK[level] > RANK[same]) same = level;
    }
    found.push({repo: group[0].repo, same, count: group.length, hosts: [...new Set(group.map(row => row.host))],
      sessions: group.map(({host, engine, branch}) => ({host, engine, branch}))});
  }
  return found.sort((a, b) => RANK[b.same] - RANK[a.same] || b.count - a.count || a.repo.localeCompare(b.repo));
}

// The one quiet line. It names who is where only when the sessions are on different computers.
export function collisionLine(collision, deviceName = host => host) {
  const crossing = collision.hosts.length > 1;
  const who = collision.sessions.map(row => crossing
    ? format(strings.sameRepo.onComputer, {engine: ENGINE_NAMES[row.engine], computer: deviceName(row.host)}) : ENGINE_NAMES[row.engine]);
  return format(strings.sameRepo.line, {count: collision.count, repo: collision.repo, where: strings.sameRepoWhere[collision.same], who: who.join(', ')});
}
