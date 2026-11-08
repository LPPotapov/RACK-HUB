// URGENT ARCHITECTURE FIX — "bind OBS/live links to current director
// event". Three known, closed Firebase namespaces now exist (see
// src/firebase/canalettoCloudPaths.js's own header for the full design
// rationale):
//   workspace     -> events/canalettoWorkspace/...  current director/live/
//                    OBS runtime, the SAFE default.
//   test          -> events/canalettoTest/...        isolated rehearsal.
//   canaletto2026 -> events/canaletto2026/...        completed historical
//                    tournament — now diagnostic-only, never the default.
//
// This repo's test runner (`node --test`) has no `window` global, so these
// tests exercise the exported pure `resolveEventSelector()`/
// `resolveEventId()` functions directly (never reading `window` itself)
// rather than the module-load-time `CANALETTO_EVENT_ID`/
// `CURRENT_EVENT_SELECTOR`/path constants, which are simply asserted to
// resolve to WORKSPACE under Node (no `window` -> falls back exactly like
// a real browser session with no query string at all) — proving the "fail
// closed toward workspace, never toward the historical tournament" safety
// property even in the total absence of a URL.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANALETTO_EVENT_ID,
  CURRENT_EVENT_SELECTOR,
  IS_HISTORICAL_2026_EVENT,
  IS_TEST_EVENT,
  IS_WORKSPACE_EVENT,
  LIVE_PATH,
  PRIVATE_STATE_PATH,
  PUBLIC_STATE_PATH,
  resolveEventId,
  resolveEventSelector
} from '../src/firebase/canalettoCloudPaths.js';
import { withEventParam } from '../src/canaletto/live/liveLinks.js';

// ---------------------------------------------------------------------------
// resolveEventSelector/resolveEventId — the ONE central selection point
// ---------------------------------------------------------------------------

test('resolveEventSelector/resolveEventId: no query string at all resolves to the WORKSPACE default (the safe-default fix)', () => {
  assert.equal(resolveEventSelector(''), 'workspace');
  assert.equal(resolveEventSelector(undefined), 'workspace');
  assert.equal(resolveEventSelector(null), 'workspace');
  assert.equal(resolveEventId(''), 'canalettoWorkspace');
});

test('resolveEventSelector/resolveEventId: "?event=test" resolves to the isolated test namespace, unchanged from before', () => {
  assert.equal(resolveEventSelector('?event=test'), 'test');
  assert.equal(resolveEventId('?event=test'), 'canalettoTest');
  assert.equal(resolveEventId('event=test'), 'canalettoTest');
});

test('resolveEventSelector/resolveEventId: "?event=canaletto2026" explicitly selects the completed historical/diagnostic namespace', () => {
  assert.equal(resolveEventSelector('?event=canaletto2026'), 'canaletto2026');
  assert.equal(resolveEventId('?event=canaletto2026'), 'canaletto2026');
});

test('resolveEventSelector: "?event=workspace" is also explicitly accepted (same result as the implicit default)', () => {
  assert.equal(resolveEventSelector('?event=workspace'), 'workspace');
  assert.equal(resolveEventId('?event=workspace'), 'canalettoWorkspace');
});

test('resolveEventId: works combined with other query params, in either order (e.g. the LIVE routes)', () => {
  assert.equal(resolveEventId('?event=test&live=tv-control'), 'canalettoTest');
  assert.equal(resolveEventId('?live=tv-control&event=test'), 'canalettoTest');
  assert.equal(resolveEventId('?live=livescore'), 'canalettoWorkspace');
});

test('resolveEventSelector: SAFETY — only the exact strings "test" and "canaletto2026" ever select anything but workspace; anything else, including a near-miss, falls back to the safe workspace default, NEVER to the historical tournament', () => {
  assert.equal(resolveEventSelector('?event=Test'), 'workspace'); // wrong case
  assert.equal(resolveEventSelector('?event=TEST'), 'workspace');
  assert.equal(resolveEventSelector('?event=testing'), 'workspace'); // near-miss
  assert.equal(resolveEventSelector('?event=canalettoTest'), 'workspace'); // raw namespace string, not a selector
  assert.equal(resolveEventSelector('?event=canalettoWorkspace'), 'workspace'); // ditto
  assert.equal(resolveEventSelector('?event=Canaletto2026'), 'workspace'); // wrong case
  assert.equal(resolveEventSelector('?event='), 'workspace'); // empty value
  assert.equal(resolveEventSelector('?event=production'), 'workspace');
  assert.equal(resolveEventSelector('?legacy=1'), 'workspace'); // unrelated param present
});

// ---------------------------------------------------------------------------
// Module-load-time resolution under Node (no `window`) — must fail CLOSED
// toward workspace, proving the default is genuinely workspace, not just
// "workspace when resolveEventSelector() is called with an empty string".
// ---------------------------------------------------------------------------

test('CANALETTO_EVENT_ID/CURRENT_EVENT_SELECTOR resolve to workspace when there is no `window` (this test runner) — same safe default as a real browser session with no query string', () => {
  assert.equal(CURRENT_EVENT_SELECTOR, 'workspace');
  assert.equal(CANALETTO_EVENT_ID, 'canalettoWorkspace');
  assert.equal(IS_WORKSPACE_EVENT, true);
  assert.equal(IS_TEST_EVENT, false);
  assert.equal(IS_HISTORICAL_2026_EVENT, false);
});

// ---------------------------------------------------------------------------
// Path constants — ALL THREE derive from the SAME selected namespace, and
// stay under the exact nested `events/<id>/...` shape the security rules
// require (never top-level `/privateState` etc.).
// ---------------------------------------------------------------------------

test('all three RTDB paths share the SAME (workspace, under this test runner) namespace root', () => {
  assert.equal(PRIVATE_STATE_PATH, 'events/canalettoWorkspace/privateState');
  assert.equal(PUBLIC_STATE_PATH, 'events/canalettoWorkspace/publicState');
  assert.equal(LIVE_PATH, 'events/canalettoWorkspace/live');
});

test('workspace, test, and the historical canaletto2026 namespaces can never alias each other — all nine path/namespace combinations are structurally distinct', () => {
  const pathsFor = (eventId) => [`events/${eventId}/privateState`, `events/${eventId}/publicState`, `events/${eventId}/live`];
  const workspacePaths = pathsFor('canalettoWorkspace');
  const testPaths = pathsFor('canalettoTest');
  const historicalPaths = pathsFor('canaletto2026');

  // Under this test runner, PRIVATE_STATE_PATH/PUBLIC_STATE_PATH/LIVE_PATH
  // are already the workspace paths (asserted above) — cross-check them
  // directly against the other two namespaces too.
  [PRIVATE_STATE_PATH, PUBLIC_STATE_PATH, LIVE_PATH].forEach((p) => {
    assert.ok(!testPaths.includes(p), `${p} must not alias a canalettoTest path`);
    assert.ok(!historicalPaths.includes(p), `${p} must not alias a canaletto2026 path`);
  });

  // And the three namespaces' own path sets never collide with each other
  // in general (not just against the currently-resolved one).
  const allPaths = [...workspacePaths, ...testPaths, ...historicalPaths];
  assert.equal(new Set(allPaths).size, allPaths.length, 'all 9 namespace/path combinations must be unique');
});

// ---------------------------------------------------------------------------
// withEventParam (liveLinks.js) — every generated/copyable public/OBS/
// stream link must carry the CURRENT director session's active selector
// explicitly, and must NEVER omit it (the exact bug this fix closes: an
// omitted selector used to be safe because it fell back to production;
// now it would silently point at a different/empty namespace than the one
// the director is actually running).
// ---------------------------------------------------------------------------

test('withEventParam ALWAYS appends the current event selector explicitly — never omits it, even under the default (workspace) context', () => {
  assert.equal(withEventParam('live=tv-control'), 'live=tv-control&event=workspace');
  assert.equal(withEventParam('live=top12&block=A'), 'live=top12&block=A&event=workspace');
  assert.equal(withEventParam('live=livescore'), 'live=livescore&event=workspace');
});

test('withEventParam uses the SAME selector resolution liveLinks.js imports from canalettoCloudPaths.js, never a second/independent one', () => {
  assert.ok(withEventParam('live=bracket').endsWith(`&event=${CURRENT_EVENT_SELECTOR}`));
});
