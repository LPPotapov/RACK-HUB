// RACK HUB PLATFORM — PHASE 1/2: series scoring-policy boundary
// (seriesScoring.js, section 5). No real Prestige/Rank FORMULA is
// introduced or tested here — these tests only prove the BOUNDARY itself:
// an imported contribution always wins FOR ITS OWN COMPETITION ONLY, a
// computed policy is called correctly (per player) when one is
// registered, and an unresolvable (player, competition) pair is reported
// rather than guessed.
//
// PHASE 2 CORRECTION: contributions are resolved PER PLAYER, and imported
// overrides are keyed by competition ID (not competition TYPE) — see
// tournamentResult.js's module header and seriesScoring.js's own header
// for the full reasoning. This file replaces the Phase 1 version, which
// tested the old per-tournament, per-TYPE shape.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeriesCompetition } from '../src/domain/seriesModel.js';
import { createImportedContributionRow, createStandingsRow, createTournamentResult } from '../src/domain/tournamentResult.js';
import {
  resolveCompetitionContributions,
  resolveTournamentContribution,
  resolveTournamentContributionsForAllPlayers
} from '../src/application/seriesScoring.js';

const fullResult = (tournamentId, rows, importedContributions) => createTournamentResult({
  tournamentId, name: 'X', date: '2026-01-01', discipline: '8-Ball',
  standings: rows,
  ...(importedContributions ? { importedContributions } : {}),
  source: { type: 'native', completeness: 'full' }
});

const legacyResult = (tournamentId, importedContributions) => createTournamentResult({
  tournamentId, name: 'Legacy Event', date: '2019-01-01', discipline: '8-Ball',
  standings: null,
  importedContributions,
  source: { type: 'manual', completeness: 'legacy-contribution' }
});

const competition = (id, tournamentIds, method = 'sum-match-points') => createSeriesCompetition({
  id, name: id, type: 'prestige', tournamentIds, scoringConfig: { method, params: {} }
});

test('an imported contribution for THIS competition is used and the registered policy is never even called', () => {
  const c = competition('c1', ['legacy-1']);
  const result = legacyResult('legacy-1', [createImportedContributionRow({ player: 'Alice', byCompetition: { c1: 99 } })]);
  let called = false;
  const registry = { 'sum-match-points': () => { called = true; return 0; } };

  const resolved = resolveTournamentContribution(c, result, { player: 'Alice' }, registry);
  assert.deepEqual(resolved, { ok: true, value: 99, source: 'imported' });
  assert.equal(called, false, 'a registered policy must never run when an imported override already covers this (player, competition) pair');
});

test('with no imported override, the registered policy is called with that player\'s standings row, the full result, and params', () => {
  const c = createSeriesCompetition({ id: 'c1', name: 'c1', type: 'prestige', tournamentIds: ['t1'], scoringConfig: { method: 'sum-match-points', params: { multiplier: 2 } } });
  const row = createStandingsRow({ placement: 1, player: 'Alice', matchPoints: 5 });
  const result = fullResult('t1', [row]);

  let receivedRow = null;
  let receivedResult = null;
  let receivedParams = null;
  const registry = {
    'sum-match-points': (r, tr, params) => {
      receivedRow = r; receivedResult = tr; receivedParams = params;
      return r.matchPoints * params.multiplier;
    }
  };

  const resolved = resolveTournamentContribution(c, result, { player: 'Alice' }, registry);
  assert.deepEqual(resolved, { ok: true, value: 10, source: 'computed' });
  assert.equal(receivedRow, row);
  assert.equal(receivedResult, result);
  assert.deepEqual(receivedParams, { multiplier: 2 });
});

// ---------------------------------------------------------------------------
// Contribution for one competition cannot accidentally override another
// (section 1's core ambiguity fix).
// ---------------------------------------------------------------------------

test('an imported override for competition A is NEVER read when resolving competition B, even for the same player/tournament', () => {
  const competitionA = competition('prestige-competition', ['t1']);
  const competitionB = competition('rank-competition', ['t1']);
  const row = createStandingsRow({ placement: 1, player: 'Alice', matchPoints: 5 });
  const result = fullResult('t1', [row], [
    createImportedContributionRow({ player: 'Alice', byCompetition: { 'prestige-competition': 999 } })
  ]);
  const registry = { 'sum-match-points': (r) => r.matchPoints };

  const resolvedA = resolveTournamentContribution(competitionA, result, { player: 'Alice' }, registry);
  assert.deepEqual(resolvedA, { ok: true, value: 999, source: 'imported' });

  // Competition B has NO override of its own — it must fall through to the
  // computed policy, never accidentally pick up competition A's 999.
  const resolvedB = resolveTournamentContribution(competitionB, result, { player: 'Alice' }, registry);
  assert.deepEqual(resolvedB, { ok: true, value: 5, source: 'computed' });
});

test('two DIFFERENT competitions of the SAME type can have independent overrides for the same player — never ambiguous', () => {
  const rankA = competition('rank-a', ['t1']);
  const rankB = competition('rank-b', ['t1']);
  rankA.type = 'rank'; rankB.type = 'rank'; // both type "rank" — the exact ambiguity the old {prestige,rank} shape could not express
  const result = legacyResult('t1', [
    createImportedContributionRow({ player: 'Alice', byCompetition: { 'rank-a': 1, 'rank-b': 2 } })
  ]);

  assert.deepEqual(resolveTournamentContribution(rankA, result, { player: 'Alice' }, {}), { ok: true, value: 1, source: 'imported' });
  assert.deepEqual(resolveTournamentContribution(rankB, result, { player: 'Alice' }, {}), { ok: true, value: 2, source: 'imported' });
});

test('a legacy-contribution result with NO matching imported row for this player, and no standings, is unresolvable, never silently 0', () => {
  const c = competition('rank-competition', ['legacy-1']);
  const result = legacyResult('legacy-1', [createImportedContributionRow({ player: 'Alice', byCompetition: { 'some-other-competition': 50 } })]);

  const resolved = resolveTournamentContribution(c, result, { player: 'Alice' }, {});
  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /no standings row and no importedContributions override/);
});

test('a missing/unregistered scoring policy is reported, not silently defaulted', () => {
  const c = competition('c1', ['t1'], 'method-nobody-registered');
  const result = fullResult('t1', [createStandingsRow({ placement: 1, player: 'Alice', matchPoints: 5 })]);
  const resolved = resolveTournamentContribution(c, result, { player: 'Alice' }, {});
  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /no scoring policy registered/);
});

test('a policy that returns a non-number is reported as unresolved, not coerced', () => {
  const c = competition('c1', ['t1']);
  const result = fullResult('t1', [createStandingsRow({ placement: 1, player: 'Alice', matchPoints: 5 })]);
  const registry = { 'sum-match-points': () => 'not a number' };
  const resolved = resolveTournamentContribution(c, result, { player: 'Alice' }, registry);
  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /finite number/);
});

// ---------------------------------------------------------------------------
// Resolving ALL players at once.
// ---------------------------------------------------------------------------

test('resolveTournamentContributionsForAllPlayers resolves every player present in standings and/or importedContributions', () => {
  const c = competition('c1', ['t1']);
  const result = fullResult(
    't1',
    [
      createStandingsRow({ placement: 1, player: 'Alice', matchPoints: 5 }),
      createStandingsRow({ placement: 2, player: 'Bob', matchPoints: 3 })
    ],
    [createImportedContributionRow({ player: 'Bob', byCompetition: { c1: 77 } })]
  );
  const registry = { 'sum-match-points': (r) => r.matchPoints };

  const resolved = resolveTournamentContributionsForAllPlayers(c, result, registry);
  assert.deepEqual(resolved, [
    { playerId: null, player: 'Alice', ok: true, value: 5, source: 'computed' },
    { playerId: null, player: 'Bob', ok: true, value: 77, source: 'imported' }
  ]);
});

test('resolveCompetitionContributions resolves every referenced tournament independently, including ones missing a supplied result', () => {
  const c = competition('c1', ['t1', 'missing-one']);
  const resultsByTournamentId = { t1: fullResult('t1', [createStandingsRow({ placement: 1, player: 'Alice', matchPoints: 5 })]) };
  const registry = { 'sum-match-points': (r) => r.matchPoints };

  const resolved = resolveCompetitionContributions(c, resultsByTournamentId, registry);
  assert.deepEqual(resolved, [
    { tournamentId: 't1', missing: false, players: [{ playerId: null, player: 'Alice', ok: true, value: 5, source: 'computed' }] },
    { tournamentId: 'missing-one', players: [], missing: true, reason: 'no TournamentResult supplied for tournamentId "missing-one"' }
  ]);
});
