// RACK HUB PLATFORM — PHASE 1: minimal player identity (section 6).
// Deliberately small — no fuzzy matching, just the manual alias table and
// its one real invariant (no ambiguous (tournamentId, sourceName) pair).

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayerAlias, resolveCanonicalPlayerId, validatePlayerAliases } from '../src/domain/playerIdentity.js';

test('resolveCanonicalPlayerId finds an explicit mapping for its exact (tournamentId, sourceName) pair', () => {
  const aliases = [
    createPlayerAlias({ canonicalPlayerId: 'canon-1', tournamentId: 'vm2026-9ball-1', sourceName: 'Richard Juros' })
  ];
  assert.equal(resolveCanonicalPlayerId(aliases, 'vm2026-9ball-1', 'Richard Juros'), 'canon-1');
});

test('resolveCanonicalPlayerId returns null (never a guess) when no mapping exists yet', () => {
  assert.equal(resolveCanonicalPlayerId([], 'vm2026-9ball-1', 'Someone Unmapped'), null);
});

test('the same source name in a DIFFERENT tournament requires its own separate alias row (no cross-tournament name matching)', () => {
  const aliases = [
    createPlayerAlias({ canonicalPlayerId: 'canon-1', tournamentId: 'vm2026-9ball-1', sourceName: 'Richard Juros' })
  ];
  assert.equal(resolveCanonicalPlayerId(aliases, 'vm2026-10ball-1', 'Richard Juros'), null);
});

test('a valid alias table (including two different real people sharing a name across two different tournaments) passes validation', () => {
  const aliases = [
    createPlayerAlias({ canonicalPlayerId: 'canon-1', tournamentId: 't1', sourceName: 'J. Smith' }),
    createPlayerAlias({ canonicalPlayerId: 'canon-2', tournamentId: 't2', sourceName: 'J. Smith' }) // different person, different event — NOT a conflict
  ];
  assert.deepEqual(validatePlayerAliases(aliases), { valid: true, errors: [] });
});

test('mapping the SAME (tournamentId, sourceName) pair to two different canonical players is rejected as ambiguous', () => {
  const aliases = [
    createPlayerAlias({ canonicalPlayerId: 'canon-1', tournamentId: 't1', sourceName: 'J. Smith' }),
    createPlayerAlias({ canonicalPlayerId: 'canon-2', tournamentId: 't1', sourceName: 'J. Smith' })
  ];
  const { valid, errors } = validatePlayerAliases(aliases);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('ambiguous mapping')));
});

test('a malformed alias (missing fields) is rejected', () => {
  const { valid, errors } = validatePlayerAliases([{ canonicalPlayerId: 'canon-1' }]);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('tournamentId')));
  assert.ok(errors.some((e) => e.includes('sourceName')));
});
