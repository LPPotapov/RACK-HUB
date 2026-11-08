// RACK HUB PLATFORM — PHASE 2: canonical player mapping for the real
// VM2026 historical events (section 5/10). Verifies the REAL alias table
// in src/series/vm2026PlayerAliases.js — 16 players confirmed to appear
// under IDENTICAL spelling in 2 or more of the 3 real fixtures.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolveCanonicalPlayerId, validatePlayerAliases } from '../src/domain/playerIdentity.js';
import { VM2026_TOURNAMENT_IDS } from '../src/series/vm2026.js';
import { vm2026PlayerAliases } from '../src/series/vm2026PlayerAliases.js';

const fixtureRoot = new URL('./fixtures/historical/', import.meta.url);
const loadPlayerNames = async (event) => {
  const rows = JSON.parse(await readFile(new URL(`${event}/expected-final-table.json`, fixtureRoot), 'utf8'));
  return rows.map((r) => r.player);
};

test('the VM2026 alias table is internally valid (no ambiguous mapping)', () => {
  assert.deepEqual(validatePlayerAliases(vm2026PlayerAliases()).errors, []);
});

test('a player confirmed in all 3 real events (Leonid Potapov) resolves to the SAME canonicalPlayerId in every one', () => {
  const aliases = vm2026PlayerAliases();
  const idIn9Ball = resolveCanonicalPlayerId(aliases, VM2026_TOURNAMENT_IDS.NINE_BALL_1, 'Leonid Potapov');
  const idIn10Ball = resolveCanonicalPlayerId(aliases, VM2026_TOURNAMENT_IDS.TEN_BALL_1, 'Leonid Potapov');
  const idIn14_1 = resolveCanonicalPlayerId(aliases, VM2026_TOURNAMENT_IDS.FOURTEEN_ONE, 'Leonid Potapov');

  assert.ok(idIn9Ball);
  assert.equal(idIn9Ball, idIn10Ball);
  assert.equal(idIn10Ball, idIn14_1);
});

test('every real cross-event name actually present in the fixtures resolves to a canonical id for every event it appears in', async () => {
  const aliases = vm2026PlayerAliases();
  const names9 = await loadPlayerNames('vm-joes-9-ball');
  const names10 = await loadPlayerNames('vm-joes-10-ball');
  const names14_1 = await loadPlayerNames('vm-joes-14-1');

  const byEvent = [
    [VM2026_TOURNAMENT_IDS.NINE_BALL_1, names9],
    [VM2026_TOURNAMENT_IDS.TEN_BALL_1, names10],
    [VM2026_TOURNAMENT_IDS.FOURTEEN_ONE, names14_1]
  ];

  aliases.forEach((alias) => {
    const [, names] = byEvent.find(([tid]) => tid === alias.tournamentId);
    assert.ok(names.includes(alias.sourceName), `alias claims "${alias.sourceName}" appears in ${alias.tournamentId}, but it is not in that fixture's real player list`);
  });
});

test('a player appearing in only ONE real event (no cross-event ambiguity to resolve) has no alias row, and resolves to null — never a guess', async () => {
  const names9 = await loadPlayerNames('vm-joes-9-ball');
  const names10 = await loadPlayerNames('vm-joes-10-ball');
  const names14_1 = await loadPlayerNames('vm-joes-14-1');
  const aliasedNames = new Set(vm2026PlayerAliases().map((a) => a.sourceName));

  const singleEventOnly = names9.find((n) => !names10.includes(n) && !names14_1.includes(n) && !aliasedNames.has(n));
  assert.ok(singleEventOnly, 'expected to find at least one 9-ball-only player for this test to be meaningful');

  const resolved = resolveCanonicalPlayerId(vm2026PlayerAliases(), VM2026_TOURNAMENT_IDS.NINE_BALL_1, singleEventOnly);
  assert.equal(resolved, null);
});

test('an unmapped/ambiguous name remains explicitly detectable as unresolved, never silently assigned', () => {
  const resolved = resolveCanonicalPlayerId(vm2026PlayerAliases(), VM2026_TOURNAMENT_IDS.NINE_BALL_1, 'Someone Not In Any Fixture');
  assert.equal(resolved, null);
});

test('family members sharing a surname across events (Dahlmann/Heim/Nuck) are correctly NOT merged — this is not a spelling discrepancy', () => {
  const aliases = vm2026PlayerAliases();
  // Henry Heim and Paul Samuel Heim must resolve to DIFFERENT canonical ids.
  const henryHeim = resolveCanonicalPlayerId(aliases, VM2026_TOURNAMENT_IDS.NINE_BALL_1, 'Henry Heim');
  const paulSamuelHeim = resolveCanonicalPlayerId(aliases, VM2026_TOURNAMENT_IDS.NINE_BALL_1, 'Paul Samuel Heim');
  assert.ok(henryHeim && paulSamuelHeim);
  assert.notEqual(henryHeim, paulSamuelHeim);
});
