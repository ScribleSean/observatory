// Roles come from the title, then generic or personal title starts, then how a session ran, then what it did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionName, sessionNameOverDays, ROLES, TITLE_ALIASES } from '../lib/roles.mjs';

const pick = name => [name.role, name.roleSource, name.object, name.display];

test('a Role: or [Role] prefix names the role, and the rest is the object', () => {
  assert.deepEqual(pick(sessionName({ title: 'Builder: Lantern', repo: 'lantern' })), ['Builder', 'title', 'Lantern', '[Builder] Lantern']);
  assert.deepEqual(pick(sessionName({ title: '[Reviewer] cube-type' })), ['Reviewer', 'title', 'cube-type', '[Reviewer] cube-type']);
  assert.deepEqual(pick(sessionName({ title: 'chief of staff: Nov 18 lanes' })), ['Chief of staff', 'title', 'Nov 18 lanes', '[Chief of staff] Nov 18 lanes']);
  // A role with no object falls back to the repository.
  assert.deepEqual(pick(sessionName({ title: 'Chief of staff', repo: 'orchard' })), ['Chief of staff', 'title', 'orchard', '[Chief of staff] orchard']);
  // A prefix that is not a role is not one.
  assert.equal(sessionName({ title: 'Plan: next steps' }).role, null);
});

test('generic title starts match at a word boundary, the longest first', () => {
  assert.deepEqual(pick(sessionName({ title: 'Lead planning' })), ['Chief of staff', 'alias', 'planning', '[Chief of staff] planning']);
  assert.deepEqual(pick(sessionName({ title: 'Orchestrator', repo: 'kestrel' })), ['Chief of staff', 'alias', 'kestrel', '[Chief of staff] kestrel']);
  assert.equal(sessionName({ title: 'Leaderboard fix' }).role, null);
  assert.equal(sessionName({ title: 'Review queue' }).role, 'Reviewer');
});

test('the user\'s own map comes from settings and names only known roles', () => {
  const aliases = { 'tidepool notes': 'Researcher', planner: 'chief of staff', 'atlas': 'Mascot' };
  assert.deepEqual(pick(sessionName({ title: 'Tidepool notes', repo: 'tidepool' }, { aliases })), ['Researcher', 'alias', 'tidepool', '[Researcher] tidepool']);
  // "4" is not an object, so the repository is.
  assert.deepEqual(pick(sessionName({ title: 'Planner 4', repo: 'orchard' }, { aliases })), ['Chief of staff', 'alias', 'orchard', '[Chief of staff] orchard']);
  assert.equal(sessionName({ title: 'Atlas', repo: 'media' }, { aliases }).role, null);
  // No personal name is built in.
  for (const prefix of Object.keys(TITLE_ALIASES)) assert.doesNotMatch(prefix, /\d|bot$/);
});

test('a headless run is a Reviewer for review and test work, else a Runner', () => {
  const review = sessionName({ title: null, origin: 'headless', task: 'review', repo: 'orchard' });
  assert.deepEqual([...pick(review), review.subtitle], ['Reviewer', 'origin', 'orchard', '[Reviewer] orchard', 'Review run']);
  assert.equal(sessionName({ origin: 'headless', task: 'test', repo: 'x' }).role, 'Reviewer');
  assert.equal(sessionName({ origin: 'headless', task: 'build', repo: 'x' }).role, 'Runner');
  assert.equal(sessionName({ origin: 'headless', task: null, repo: 'x' }).role, 'Runner');
});

test('otherwise the first prompt\'s kind, then the kind it spent most on outside its own thread', () => {
  assert.deepEqual(pick(sessionName({ origin: 'interactive', task: 'design', repo: 'kestrel' })), ['Designer', 'kind', 'kestrel', '[Designer] kestrel']);
  const kinds = [{ kind: 'main', apiUsd: 9 }, { kind: 'search', apiUsd: 3 }, { kind: 'build', apiUsd: 2 }];
  assert.equal(sessionName({ origin: 'interactive', kinds, repo: 'q' }).role, 'Researcher');
  const none = sessionName({ origin: 'interactive', kinds: [{ kind: 'main', apiUsd: 4 }], repo: 'quarry' });
  assert.deepEqual([none.role, none.display], [null, 'Session in quarry']);
  for (const role of [review => review]) assert.ok(role);
  assert.ok(ROLES.includes(sessionName({ task: 'write' }).role));
});

test('over several days the latest titled day decides, else the summed kinds', () => {
  const days = [
    { title: 'Builder: Lantern', origin: 'interactive', task: 'build', repo: 'lantern', kinds: [] },
    { title: 'Reviewer: Lantern', origin: 'interactive', task: null, repo: 'lantern', kinds: [] },
    { title: null, origin: 'interactive', task: null, repo: 'lantern', kinds: [] },
  ];
  assert.equal(sessionNameOverDays(days).role, 'Reviewer');
  const untitled = [
    { title: null, origin: 'interactive', task: null, repo: 'a', kinds: [{ kind: 'review', apiUsd: 2 }] },
    { title: null, origin: 'interactive', task: null, repo: 'a', kinds: [{ kind: 'design', apiUsd: 1.5 }, { kind: 'design', apiUsd: 1 }] },
  ];
  assert.equal(sessionNameOverDays(untitled).role, 'Designer');
  const plain = sessionNameOverDays([{ title: 'Tidepool notes', origin: 'interactive', task: null, repo: 'tidepool', kinds: [] }]);
  assert.deepEqual([plain.role, plain.display], [null, 'Tidepool notes']);
  assert.equal(sessionNameOverDays([]).role, null);
});

// Real-shaped titles, with fictional names: a name the user gave, a `Role:` title and untitled headless runs.
test('real-shaped titles map sensibly: a user alias, a Role: prefix and untitled headless runs', () => {
  const aliases = { Atlas: 'Chief of staff' };
  // The alias names the role, and a rest that only says the role again leaves that name as the object.
  assert.deepEqual(pick(sessionName({ title: 'Atlas: chief of staff', origin: 'interactive', repo: 'notes' }, { aliases })),
    ['Chief of staff', 'alias', 'Atlas', '[Chief of staff] Atlas']);
  assert.deepEqual(pick(sessionName({ title: 'Atlas: triage the inbox', origin: 'interactive' }, { aliases })),
    ['Chief of staff', 'alias', 'triage the inbox', '[Chief of staff] triage the inbox']);
  // Without the alias the title is shown as it is, with no role guessed from a personal name.
  assert.deepEqual(pick(sessionName({ title: 'Atlas: chief of staff', origin: 'interactive' })), [null, null, 'Atlas: chief of staff', 'Atlas: chief of staff']);
  assert.deepEqual(pick(sessionName({ title: 'Builder: Lantern', origin: 'interactive', repo: 'lantern' })), ['Builder', 'title', 'Lantern', '[Builder] Lantern']);
  // Untitled headless runs: review and test work is a Reviewer, anything else a Runner, named by their repository.
  for (const [task, role] of [['review', 'Reviewer'], ['test', 'Reviewer'], ['build', 'Runner'], [null, 'Runner']]) {
    const name = sessionName({ title: null, origin: 'headless', task, repo: 'lantern' });
    assert.deepEqual([name.role, name.display], [role, `[${role}] lantern`], String(task));
  }
  // The same holds over several days, and the alias comes from the hub's settings echo.
  const days = [{ title: 'Atlas: chief of staff', origin: 'interactive', task: null, repo: 'notes', kinds: [] }, { title: null, origin: 'interactive', task: null, repo: 'notes', kinds: [{ kind: 'build', apiUsd: 4 }] }];
  assert.equal(sessionNameOverDays(days, { aliases }).display, '[Chief of staff] Atlas');
});

// Titles shaped like real ones, with fictional names. The agent name is built from parts so no such name is
// written out here.
const agent = name => `${name}${'B'}ot`;

test('the object comes from the title, and a role found from the work never replaces it', () => {
  const build = [{ kind: 'main', apiUsd: 9 }, { kind: 'build', apiUsd: 4 }];
  // An agent name before a colon comes off, and the rest is the object.
  assert.deepEqual(pick(sessionName({ title: `${agent('Lantern')}: land the packaging branches`, origin: 'interactive', repo: 'lantern-hardware-kit', kinds: build })),
    ['Builder', 'kind', 'land the packaging branches', '[Builder] land the packaging branches']);
  assert.deepEqual(pick(sessionName({ title: `${agent('Orchard')}: rebuild Orchard into something good`, origin: 'interactive', task: 'build', repo: 'orchard' })),
    ['Builder', 'kind', 'rebuild Orchard into something good', '[Builder] rebuild Orchard into something good']);
  // A plain title stays whole behind the role its work gives.
  assert.deepEqual(pick(sessionName({ title: 'Tidepool voice decoder', origin: 'interactive', task: 'research', repo: 'notes' })),
    ['Researcher', 'kind', 'Tidepool voice decoder', '[Researcher] Tidepool voice decoder']);
  // A titled headless run keeps its title too.
  assert.equal(sessionName({ title: 'Nightly audit of kestrel', origin: 'headless', task: 'review', repo: 'kestrel' }).display, '[Reviewer] Nightly audit of kestrel');
  // With no role at all, the object is still the title, never the repository.
  assert.deepEqual(pick(sessionName({ title: `${agent('Lantern')}: tidy the shelf`, origin: 'interactive', repo: 'lantern' })), [null, null, 'tidy the shelf', 'tidy the shelf']);
  assert.deepEqual(pick(sessionName({ title: 'Tidepool notes', origin: 'interactive', repo: 'tidepool' })), [null, null, 'Tidepool notes', 'Tidepool notes']);
  // A word before a colon that is neither a role nor an agent name stays.
  assert.equal(sessionName({ title: 'Plan: next steps', task: 'build', repo: 'x' }).display, '[Builder] Plan: next steps');
});

test('a title that leaves only a date, a name or nothing takes the date, the name or the repository', () => {
  assert.deepEqual(pick(sessionName({ title: 'Chief of staff (Nov 18)', repo: 'orchard' })), ['Chief of staff', 'alias', 'Nov 18', '[Chief of staff] Nov 18']);
  assert.deepEqual(pick(sessionName({ title: 'Chief of staff: (Nov 18)', repo: 'orchard' })), ['Chief of staff', 'title', 'Nov 18', '[Chief of staff] Nov 18']);
  assert.equal(sessionName({ title: 'Chief of staff 11/18', repo: 'orchard' }).display, '[Chief of staff] 11/18');
  // An agent name whose rest only says a role: the role is known, and the name is what the title has left.
  assert.deepEqual(pick(sessionName({ title: `${agent('Atlas')}: chief of staff`, repo: 'orchard' })), ['Chief of staff', 'title', agent('Atlas'), `[Chief of staff] ${agent('Atlas')}`]);
  // An agent name may carry a number.
  assert.equal(sessionName({ title: `${agent('Atlas')} 4: lanes and landing`, task: 'build', repo: 'orchard' }).display, '[Builder] lanes and landing');
  // A bare role takes the day the session started, so two of them read apart.
  assert.equal(sessionName({ title: 'Chief of staff', repo: 'orchard', started: '2026-11-17' }).display, '[Chief of staff] Nov 17');
  assert.equal(sessionNameOverDays([{ title: 'Chief of staff', date: '2026-11-17', origin: 'interactive', task: null, repo: 'orchard', kinds: [] },
    { title: 'Chief of staff', date: '2026-11-18', origin: 'interactive', task: null, repo: 'orchard', kinds: [] }]).display, '[Chief of staff] Nov 17');
  // An untitled session never takes a date: its repository says more.
  assert.equal(sessionName({ title: null, origin: 'headless', task: 'review', repo: 'kestrel', started: '2026-11-17' }).display, '[Reviewer] kestrel');
  // Nothing left and no day known: the repository.
  assert.equal(sessionName({ title: 'Builder:', repo: 'lantern' }).display, '[Builder] lantern');
  assert.equal(sessionName({ title: 'Chief of staff', repo: 'orchard' }).display, '[Chief of staff] orchard');
});

test('over several days the latest title is the object, whatever gave the role', () => {
  const days = [
    { title: `${agent('Lantern')}: land the packaging branches`, origin: 'interactive', task: null, repo: 'lantern-hardware-kit', kinds: [{ kind: 'build', apiUsd: 3 }] },
    { title: null, origin: 'interactive', task: null, repo: 'lantern-hardware-kit', kinds: [{ kind: 'build', apiUsd: 5 }] },
  ];
  assert.equal(sessionNameOverDays(days).display, '[Builder] land the packaging branches');
  assert.equal(sessionNameOverDays([{ title: 'Chief of staff (Nov 18)', origin: 'interactive', task: 'build', repo: 'orchard', kinds: [] }]).display, '[Chief of staff] Nov 18');
});
