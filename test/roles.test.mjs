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
  const aliases = { 'tidepool notes': 'Researcher', ceobot: 'chief of staff', 'mediabot': 'Mascot' };
  assert.deepEqual(pick(sessionName({ title: 'Tidepool notes', repo: 'tidepool' }, { aliases })), ['Researcher', 'alias', 'tidepool', '[Researcher] tidepool']);
  // "4" is not an object, so the repository is.
  assert.deepEqual(pick(sessionName({ title: 'CEOBot 4', repo: 'orchard' }, { aliases })), ['Chief of staff', 'alias', 'orchard', '[Chief of staff] orchard']);
  assert.equal(sessionName({ title: 'MediaBot', repo: 'media' }, { aliases }).role, null);
  // No personal name is built in.
  for (const prefix of Object.keys(TITLE_ALIASES)) assert.doesNotMatch(prefix, /bot|ceo|agi/);
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
