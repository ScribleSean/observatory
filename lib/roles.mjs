// What each session is for: a small fixed set of roles, so the Sessions view can group and total by role.
//
// A session's role comes from, in order:
// 1. A `Role:` prefix in its title ("Builder: Observatory", "[Reviewer] cube-type"), when the role is
//    one of ROLES. The rest of the title is the object.
// 2. The title prefix map: TITLE_ALIASES, then the user's own `sessions.roles` map from the settings
//    file (echoed in view.config), matched against the start of the title, case-insensitive. Private
//    naming habits belong in the user's settings file, never in this list. When the rest of the title
//    only says the role again ("Atlas: chief of staff"), the start is the object ("Atlas").
// 3. How it ran: a headless session (no one typed) is a Reviewer when its task is review or test, else a Runner.
// 4. What it did: its first prompt's kind (`task`), else the work kind it spent most on outside its
//    own thread, through KIND_ROLES.
// 5. Otherwise no role. The table shows the title alone and groups it under Other.
//
// The object is what the session is about, and it comes from the title whenever there is one: the title
// with its `Role:` prefix off, or with a one-word agent name ending in "bot" and a colon off its start
// ("<Name>bot: land the branches" reads "land the branches"). A role found from how the session ran or
// what it did never replaces the title. A date in the title is an object ("Nov 18"). A title that is
// only a role ("Chief of staff") takes the day the session started, so two of them read apart, and
// the repository when no day is known. With neither, it reads as the role alone. A session with no
// title takes the repository it ran in.

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
 * @property {string | null} [started]       The first day it ran, YYYY-MM-DD, when known.
 *
 * @typedef {object} SessionName
 * @property {Role | null} role
 * @property {RoleSource | null} roleSource
 * @property {string} object                 "Observatory". From the title, else the repository, else sessionLabel.
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
// A one-word agent name ending in "bot", then a colon, then what the session is doing.
// The name may carry a number ("<Name>bot 4: lanes and landing").
const AGENT = /^\s*(\p{L}[\p{L}\p{N}_-]*bot(?:\s+\d+)?)\s*:\s*(.*)$/isu;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2026-11-17" reads "Nov 17".
const dayLabel = date => { const found = typeof date === 'string' ? date.match(/^\d{4}-(\d\d)-(\d\d)$/) : null; return found && MONTHS[Number(found[1]) - 1] ? `${MONTHS[Number(found[1]) - 1]} ${Number(found[2])}` : null; };
// "(Nov 18)" reads "Nov 18".
const tidy = value => { const inner = String(value ?? '').trim().replace(/^\((.*)\)$/s, '$1').trim(); return inner || null; };
const roleNamed = value => ROLES.find(role => lower(role) === lower(value.trim())) ?? null;
// The rest of a title after a role word, when it names something: "Lead planning" leaves "planning",
// "Planner 4" leaves nothing worth showing.
const rest = value => { const left = tidy(value.replace(/^[\s:\-–|]+/, '')); return left && (/\p{L}{2}/u.test(left) || /\d+[/.-]\d+/.test(left)) ? left : null; };

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

// Whether the rest of a title only says the role again: "Atlas: chief of staff".
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

function named(session, role, roleSource, object, { alone = false } = {}) {
  const known = (text(session.title) ? dayLabel(session.started) : null) ?? text(session.repo);
  // A title that is only a role, with no day or repository to tell it apart, reads as the role alone.
  if (alone && object === null && known === null) object = role;
  const shown = object ?? known ?? sessionLabel({ origin: session.origin, task: session.task });
  const display = alone && shown === role ? role : `[${role}] ${shown}`;
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
  // What the title says the session is about, once a name at its start is off.
  let about = title;
  if (title) {
    const prefix = title.match(PREFIX);
    const role = prefix ? roleNamed(prefix[1] ?? prefix[2]) : null;
    if (role) return named(input, role, 'title', tidy(prefix[3]));
    const exact = roleNamed(title);
    if (exact) return named(input, exact, 'title', null, { alone: true });
    const alias = aliasMatch(title, aliases);
    // When the rest only says the role again, the title's own start names the session: "[Chief of staff] Atlas".
    if (alias) return named(input, alias.role, 'alias', alias.left && restates(alias.left, alias.role) ? alias.start : alias.left);
    const agent = title.match(AGENT);
    const doing = agent ? tidy(agent[2]) : null;
    const said = doing ? roleNamed(doing) ?? TITLE_ALIASES[lower(doing)] ?? null : null;
    // An agent name whose rest is only a role: the role is known and the name is all the title has left.
    if (said) return named(input, said, 'title', agent[1]);
    about = doing ?? title;
  }
  if (input.origin === 'headless') return named(input, ['review', 'test'].includes(input.task) ? 'Reviewer' : 'Runner', 'origin', about);
  const fromKind = (Object.hasOwn(KIND_ROLES, input.task) ? KIND_ROLES[input.task] : null) ?? kindRole(input.kinds);
  if (fromKind) return named(input, fromKind, 'kind', about);
  return { role: null, roleSource: null, object: about ?? text(input.repo) ?? sessionLabel(input), display: about ?? sessionLabel(input), subtitle: null };
}

/**
 * The name of a session seen on several days: its latest title decides the object, and the role when it
 * names one. Otherwise the role comes from how it ran and its kinds summed over the days.
 * @param {RoleInputs[]} days  Oldest first.
 * @param {{aliases?: Record<string, string>}} [options]
 * @returns {SessionName}
 */
export function sessionNameOverDays(days, { aliases = {} } = {}) {
  const list = Array.isArray(days) ? days.filter(object) : [];
  const last = (key) => [...list].reverse().map(day => day[key]).find(value => value !== null && value !== undefined) ?? null;
  const merged = { title: null, origin: last('origin'), task: list.map(day => day.task).find(value => value) ?? null,
    repo: last('repo'), kinds: list.flatMap(day => Array.isArray(day.kinds) ? day.kinds : []),
    started: list.map(day => day.date).filter(date => typeof date === 'string').sort()[0] ?? null };
  const titled = [...list].reverse().find(day => text(day.title));
  return sessionName({ ...merged, title: titled ? titled.title : null }, { aliases });
}
