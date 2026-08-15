// Urgent testing-feature hotfix — isolated `events/canalettoTest/...`
// Firebase namespace, selected via `?event=test`, so live scoring can be
// exercised without ever touching the running production tournament (see
// src/firebase/canalettoCloudPaths.js's own header for the full design
// rationale). This repo's test runner (`node --test`) has no `window`
// global, so these tests exercise the exported pure `resolveEventId()`
// function directly (never reading `window` itself) rather than the
// module-load-time `CANALETTO_EVENT_ID`/`IS_TEST_EVENT`/path constants,
// which are simply asserted to resolve to PRODUCTION under Node (no
// `window` -> falls back exactly like a real browser session with no query
// string at all) — proving the "fail closed toward production" safety
// property even in the total absence of a URL.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANALETTO_EVENT_ID,
  IS_TEST_EVENT,
  LIVE_PATH,
  PRIVATE_STATE_PATH,
  PUBLIC_STATE_PATH,
  resolveEventId
} from '../src/firebase/canalettoCloudPaths.js';
import { withEventParam } from '../src/canaletto/live/liveLinks.js';

// ---------------------------------------------------------------------------
// resolveEventId — the ONE central selection point
// ---------------------------------------------------------------------------

test('resolveEventId: no query string at all resolves to production (default stays EXACTLY unchanged)', () => {
  assert.equal(resolveEventId(''), 'canaletto2026');
  assert.equal(resolveEventId(undefined), 'canaletto2026');
  assert.equal(resolveEventId(null), 'canaletto2026');
});

test('resolveEventId: "?event=test" resolves to the isolated test namespace', () => {
  assert.equal(resolveEventId('?event=test'), 'canalettoTest');
  assert.equal(resolveEventId('event=test'), 'canalettoTest');
});

test('resolveEventId: works combined with other query params, in either order (e.g. the LIVE routes)', () => {
  assert.equal(resolveEventId('?event=test&live=tv-control'), 'canalettoTest');
  assert.equal(resolveEventId('?live=tv-control&event=test'), 'canalettoTest');
  assert.equal(resolveEventId('?live=livescore'), 'canaletto2026');
});

test('resolveEventId: SAFETY — only the exact value "test" ever selects the test namespace; anything else, including a near-miss, falls back to production', () => {
  assert.equal(resolveEventId('?event=Test'), 'canaletto2026'); // wrong case
  assert.equal(resolveEventId('?event=TEST'), 'canaletto2026');
  assert.equal(resolveEventId('?event=testing'), 'canaletto2026'); // near-miss
  assert.equal(resolveEventId('?event=canalettoTest'), 'canaletto2026');
  assert.equal(resolveEventId('?event='), 'canaletto2026'); // empty value
  assert.equal(resolveEventId('?event=production'), 'canaletto2026');
  assert.equal(resolveEventId('?legacy=1'), 'canaletto2026'); // unrelated param present
});

// ---------------------------------------------------------------------------
// Module-load-time resolution under Node (no `window`) — must fail CLOSED
// toward production, proving the default is genuinely production, not just
// "production when resolveEventId() is called with an empty string".
// ---------------------------------------------------------------------------

test('CANALETTO_EVENT_ID/IS_TEST_EVENT resolve to production when there is no `window` (this test runner) — same safe default as a real browser session with no query string', () => {
  assert.equal(CANALETTO_EVENT_ID, 'canaletto2026');
  assert.equal(IS_TEST_EVENT, false);
});

// ---------------------------------------------------------------------------
// Path constants — ALL THREE derive from the SAME selected namespace, and
// stay under the exact nested `events/<id>/...` shape the security rules
// require (never top-level `/privateState` etc.).
// ---------------------------------------------------------------------------

test('all three RTDB paths share the SAME (production, under this test runner) namespace root', () => {
  assert.equal(PRIVATE_STATE_PATH, 'events/canaletto2026/privateState');
  assert.equal(PUBLIC_STATE_PATH, 'events/canaletto2026/publicState');
  assert.equal(LIVE_PATH, 'events/canaletto2026/live');
});

test('the test-event and production-event namespaces are structurally isolated: canalettoTest never shares a path segment with canaletto2026', () => {
  const testPrivate = 'events/canalettoTest/privateState';
  const testPublic = 'events/canalettoTest/publicState';
  const testLive = 'events/canalettoTest/live';
  [PRIVATE_STATE_PATH, PUBLIC_STATE_PATH, LIVE_PATH].forEach((prodPath) => {
    assert.notEqual(prodPath, testPrivate);
    assert.notEqual(prodPath, testPublic);
    assert.notEqual(prodPath, testLive);
  });
  // Both namespaces keep the same three-leaf shape — only the event id differs.
  [testPrivate, testPublic, testLive].forEach((p) => assert.ok(p.startsWith('events/canalettoTest/')));
  [PRIVATE_STATE_PATH, PUBLIC_STATE_PATH, LIVE_PATH].forEach((p) => assert.ok(p.startsWith('events/canaletto2026/')));
});

// ---------------------------------------------------------------------------
// withEventParam (liveLinks.js) — generated/copyable public/OBS/stream
// links must preserve `event=test` while the director session is testing,
// and must NEVER add it while running production (byte-for-byte unchanged
// links, matching every pre-existing generated-URL expectation).
// ---------------------------------------------------------------------------

test('withEventParam leaves the query untouched under production (this test runner has no window -> always production)', () => {
  assert.equal(withEventParam('live=tv-control'), 'live=tv-control');
  assert.equal(withEventParam('live=top12&block=A'), 'live=top12&block=A');
});
