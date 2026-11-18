// What each session is for: a small fixed set of roles, so the Sessions view can group and total by role.
// See docs/R2-PLAN.md.
//
// A session's role comes from, in order:
// 1. A `Role:` prefix in its title ("Builder: Observatory", "[Reviewer] cube-type"), when the role is
//    one of ROLES. The rest of the title is the object.
// 2. The title prefix map: TITLE_ALIASES, then the user's own `sessions.roles` map from the settings
//    file (echoed in view.config), matched against the start of the title, case-insensitive. Private
//    naming habits belong in the user's settings file, never in this list. When the rest of the title
//    only says the role again ("AGIBot: chief of staff"), the start is the object ("AGIBot").
// 3. How it ran: a headless session (no one typed) is a Reviewer when its task is review or test, else a Runner.
// 4. What it did: its first prompt's kind (`task`), else the work kind it spent most on outside its
//    own thread, through KIND_ROLES.
// 5. Otherwise no role. The table shows "Session" and groups it under Other.
// The object, when the title gives none, is the repository the session ran in.

import { sessionLabel } from './ledger-join.mjs';

/**
 * @typedef {'Chief of staff' | 'Builder' | 'Reviewer' | 'Designer' | 'Researcher' | 'Runner' | 'Sweeper' | 'Ops'} Role
 *
 * @typedef {'title' | 'alias' | 'origin' | 'kind'} RoleSource   How the role was found, shown on hover.
 *
 * @typedef {object} RoleInputs              Fields of a ledger session or a SessionDay (lib/r2-shape.mjs).
 * @property {string | null} title
 * @property {'headless' | 'interactive' | null} origin
 * @property {import('./ledger-shape.mjs').WorkKind | null} task
 * @property {string | null} repo
 * @property {{kind: string, apiUsd: number | null}[]} kinds
 *
 * @typedef {object} SessionName
 * @property {Role | null} role
 * @property {RoleSource | null} roleSource
 * @property {string} object                 "Observatory". The title rest, else the repository, else sessionLabel.
 * @property {string} display                "[Builder] Observatory", or the plain label with no role.
 * @property {string | null} subtitle        The task and how it ran ("Review run"), when that adds something.
 */

export const ROLES = Object.freeze(['Chief of staff', 'Builder', 'Reviewer', 'Designer', 'Researcher', 'Runner', 'Sweeper', 'Ops']);

// Generic title starts that mean a role. Anyone's naming, so nothing personal.
export const TITLE_ALIASES = Object.freeze({
  'chief of staff': 'Chief of staff', chief: 'Chief of staff', orchestrator: 'Chief of staff', coordinator: 'Chief of staff', lead: 'Chief of staff',
  builder: 'Builder', reviewer: 'Reviewer', review: 'Reviewer', designer: 'Designer', researcher: 'Researcher', research: 'Researcher',
  runner: 'Runner', sweeper: 'Sweeper', ops: 'Ops',
});

// Work kind to role. 'main' and 'other' say nothing about the work, so they give no role.
export const KIND_ROLES = Object.freeze({
  build: 'Builder', review: 'Reviewer', test: 'Reviewer', design: 'Designer', research: 'Researcher', search: 'Researcher', write: 'Builder',
});

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const lower = value => value.toLowerCase();
// "Builder: Lantern" or "[Builder] Lantern", with a role from ROLES.
const PREFIX = /^\s*(?:\[([^\]]+)\]|([^:[\]]+):)\s*(.*)$/s;
const roleNamed = value => ROLES.find(role => lower(role) === lower(value.trim())) ?? null;
// The rest of a title after a role word, when it names something: "Lead planning" leaves "planning",
// "Planner 4" leaves nothing worth showing.
const rest = value => { const left = value.replace(/^[\s:\-–|]+/, '').trim(); return /\p{L}{2}/u.test(left) ? left : null; };

function aliasMatch(title, aliases) {
  const own = Object.entries(object(aliases) ? aliases : {}).flatMap(([prefix, role]) => {
    const found = typeof role === 'string' ? roleNamed(role) : null;
    return text(prefix) && found ? [[lower(prefix.trim()), found]] : [];
  });
  const name = lower(title);
  // The generic starts first, then the user's own, and the longest start wins inside each list.
  for (const list of [Object.entries(TITLE_ALIASES), own]) {
    for (const [prefix, role] of [...list].sort((a, b) => b[0].length - a[0].length)) {
      if (!name.startsWith(prefix) || /[\p{L}\p{N}]/u.test(name.charAt(prefix.length))) continue;
      return { role, left: rest(title.slice(prefix.length)), start: title.slice(0, prefix.length).trim() };
    }
  }
  return null;
}

// Whether the rest of a title only says the role again: "AGIBot: chief of staff".
const restates = (left, role) => lower(left) === lower(role) || TITLE_ALIASES[lower(left)] === role;

// The kind it spent most on outside its own thread, when that kind names a role.
function kindRole(kinds) {
  const totals = new Map();
  for (const part of Array.isArray(kinds) ? kinds.filter(object) : []) {
    if (!Object.hasOwn(KIND_ROLES, part.kind) || typeof part.apiUsd !== 'number') continue;
    totals.set(part.kind, (totals.get(part.kind) ?? 0) + part.apiUsd); // zero-ok: starts a running sum
  }
  const top = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top ? KIND_ROLES[top[0]] : null;
}

function named(session, role, roleSource, object) {
  const fallbackObject = text(session.repo) ?? sessionLabel({ origin: session.origin, task: session.task });
  const shown = object ?? fallbackObject;
  const display = role ? `[${role}] ${shown}` : (text(session.title) ?? sessionLabel(session));
  const how = session.origin === 'headless' || session.task ? sessionLabel({ origin: session.origin, task: session.task }) : null;
  return { role, roleSource, object: shown, display, subtitle: how && how !== shown && how !== display ? how : null };
}

/**
 * @param {RoleInputs} session
 * @param {{aliases?: Record<string, string>}} [options]  The user's sessions.roles map from view.config.
 * @returns {SessionName}
 */
export function sessionName(session, { aliases = {} } = {}) {
  const input = object(session) ? session : {};
  const title = text(input.title);
  if (title) {
    const prefix = title.match(PREFIX);
    const role = prefix ? roleNamed(prefix[1] ?? prefix[2]) : null;
    if (role) return named(input, role, 'title', text(prefix[3]));
    const exact = roleNamed(title);
    if (exact) return named(input, exact, 'title', null);
    const alias = aliasMatch(title, aliases);
    // When the rest only says the role again, the title's own start names the session: "[Chief of staff] AGIBot".
    if (alias) return named(input, alias.role, 'alias', alias.left && restates(alias.left, alias.role) ? alias.start : alias.left);
  }
  if (input.origin === 'headless') return named(input, ['review', 'test'].includes(input.task) ? 'Reviewer' : 'Runner', 'origin', null);
  const fromKind = (Object.hasOwn(KIND_ROLES, input.task) ? KIND_ROLES[input.task] : null) ?? kindRole(input.kinds);
  if (fromKind) return named(input, fromKind, 'kind', null);
  return { role: null, roleSource: null, object: text(input.repo) ?? sessionLabel(input), display: title ?? sessionLabel(input), subtitle: null };
}

/**
 * The role of a session seen on several days: the role found on its latest day with a title, else the
 * role its summed kinds give.
 * @param {RoleInputs[]} days  Oldest first.
 * @param {{aliases?: Record<string, string>}} [options]
 * @returns {SessionName}
 */
export function sessionNameOverDays(days, { aliases = {} } = {}) {
  const list = Array.isArray(days) ? days.filter(object) : [];
  const last = (key) => [...list].reverse().map(day => day[key]).find(value => value !== null && value !== undefined) ?? null;
  const merged = { title: null, origin: last('origin'), task: list.map(day => day.task).find(value => value) ?? null,
    repo: last('repo'), kinds: list.flatMap(day => Array.isArray(day.kinds) ? day.kinds : []) };
  const titled = [...list].reverse().find(day => text(day.title));
  if (titled) {
    const name = sessionName({ ...merged, title: titled.title }, { aliases });
    if (name.roleSource === 'title' || name.roleSource === 'alias') return name;
  }
  const name = sessionName(merged, { aliases });
  return titled && !name.role ? { ...name, display: text(titled.title), object: text(merged.repo) ?? text(titled.title) } : name;
}
