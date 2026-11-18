// What each session is for: a small fixed set of roles, so the Sessions view can group and total by role.
// Contract only. Lane b (view-models) writes the bodies. See docs/R2-PLAN.md.
//
// A session's role comes from, in order:
// 1. A `Role:` prefix in its title ("Builder: Observatory", "[Reviewer] cube-type"), when the role is
//    one of ROLES. The rest of the title is the object.
// 2. The title prefix map: TITLE_ALIASES, then the user's own `sessions.roles` map from the settings
//    file (echoed in view.config), matched against the start of the title, case-insensitive. Private
//    naming habits belong in the user's settings file, never in this list.
// 3. How it ran: a headless session (no one typed) is a Reviewer when its task is review or test, else a Runner.
// 4. What it did: its first prompt's kind (`task`), else the work kind it spent most on outside its
//    own thread, through KIND_ROLES.
// 5. Otherwise no role. The table shows "Session" and groups it under Other.
// The object, when the title gives none, is the repository the session ran in.

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

const todo = name => { throw new Error(`${name} is not implemented yet (round 2, lane b)`); };

/**
 * @param {RoleInputs} session
 * @param {{aliases?: Record<string, string>}} [options]  The user's sessions.roles map from view.config.
 * @returns {SessionName}
 */
export function sessionName(session, { aliases = {} } = {}) { return todo('sessionName'); }

/**
 * The role of a session seen on several days: the role found on its latest day with a title, else the
 * role its summed kinds give.
 * @param {RoleInputs[]} days  Oldest first.
 * @param {{aliases?: Record<string, string>}} [options]
 * @returns {SessionName}
 */
export function sessionNameOverDays(days, { aliases = {} } = {}) { return todo('sessionNameOverDays'); }
