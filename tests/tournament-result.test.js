// RACK HUB PLATFORM — PHASE 1: TournamentResult (tests section 8 A/B/C).
// Grounded in the REAL vm-joes-9-ball historical fixture (section 8B)
// rather than invented placeholder data, since this project already has a
// real "standings-only, no match history" historical result sitting in
// tests/fixtures/historical/vm-joes-9-ball/.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  COMPLETENESS_LEVELS,
  SOURCE_TYPES,
  createImportedContributionRow,
  createStandingsRow,
  createTournamentResult,
  validateTournamentResult
} from '../src/domain/tournamentResult.js';

const fixtureRoot = new URL('./fixtures/historical/', import.meta.url);
const load = async (event, file) => JSON.parse(await readFile(new URL(`${event}/${file}`, fixtureRoot), 'utf8'));

// ---------------------------------------------------------------------------
// A. full/native result is accepted
// ---------------------------------------------------------------------------

test('A: a full/native TournamentResult (standings + matches) is accepted', () => {
  const result = createTournamentResult({
    tournamentId: 'native-block-a-2026',
    name: 'Native Block A',
    date: '2026-09-01',
    discipline: '9-Ball',
    participants: [{ playerId: 'p1', name: 'Alice' }, { playerId: 'p2', name: 'Bob' }],
    standings: [
      createStandingsRow({ placement: 1, playerId: 'p1', player: 'Alice', matchPoints: 5 }),
      createStandingsRow({ placement: 2, playerId: 'p2', player: 'Bob', matchPoints: 3 })
    ],
    matches: [{ id: 1, p1: 'p1', p2: 'p2', r1: 7, r2: 3, done: true }],
    source: { type: 'native', completeness: 'full' }
  });

  const { valid, errors } = validateTournamentResult(result);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
  assert.equal(result.matches.length, 1);
});

// ---------------------------------------------------------------------------
// B. standings-only historical result is accepted without matches —
// using the REAL vm-joes-9-ball fixture.
// ---------------------------------------------------------------------------

test('B: the real vm-joes-9-ball historical standings-only fixture is accepted with no match history', async () => {
  const metadata = await load('vm-joes-9-ball', 'metadata.json');
  const rows = await load('vm-joes-9-ball', 'expected-final-table.json');

  const result = createTournamentResult({
    tournamentId: 'vm-joes-9-ball-2026',
    name: metadata.tournamentName,
    date: metadata.date,
    discipline: metadata.discipline,
    participants: rows.map((r) => ({ playerId: null, name: r.player })),
    standings: rows.map((r) => createStandingsRow({
      placement: r.placement,
      playerId: null,
      player: r.player,
      matchPoints: r.matchPoints,
      prestige: r.prestige,
      eventScore: r.eventScore,
      racksWon: r.racksWon,
      racksLost: r.racksLost
    })),
    source: { type: 'csv', completeness: 'standings' }
  });

  const { valid, errors } = validateTournamentResult(result);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
  assert.equal(result.standings.length, metadata.playerCount);
  assert.equal('matches' in result, false, 'standings-only result must not require/invent a matches field');
  assert.equal(result.standings[0].prestige, rows[0].prestige, 'real historical prestige value passes through unmodified');
});

// ---------------------------------------------------------------------------
// C. legacy contribution result is accepted
// ---------------------------------------------------------------------------

test('C: a legacy-contribution result (no standings, authoritative imported Prestige) is accepted', () => {
  const result = createTournamentResult({
    tournamentId: 'legacy-event-pre-2020',
    name: 'Pre-digital Club Championship',
    date: '2019-05-01',
    discipline: '8-Ball',
    participants: [{ playerId: null, name: 'Someone Who Played' }],
    standings: null,
    importedContributions: [
      createImportedContributionRow({ player: 'Someone Who Played', byCompetition: { 'some-prestige-competition': 42 } })
    ],
    source: { type: 'manual', completeness: 'legacy-contribution' }
  });

  const { valid, errors } = validateTournamentResult(result);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
  assert.equal(result.standings, null);
});

test('C: legacy-contribution WITHOUT an imported override is rejected (never silently inferred)', () => {
  const result = createTournamentResult({
    tournamentId: 'legacy-event-no-override',
    name: 'Pre-digital Club Championship',
    date: '2019-05-01',
    discipline: '8-Ball',
    participants: [{ name: 'Someone' }],
    standings: null,
    source: { type: 'manual', completeness: 'legacy-contribution' }
  });

  const { valid, errors } = validateTournamentResult(result);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('importedContributions')));
});

// ---------------------------------------------------------------------------
// H (TournamentResult-level slice): malformed values rejected.
// ---------------------------------------------------------------------------

test('H: unsupported source.completeness value is rejected', () => {
  const result = createTournamentResult({
    tournamentId: 't1', name: 'X', date: '2026-01-01', discipline: '8-Ball',
    standings: [], source: { type: 'native', completeness: 'definitely-not-a-real-level' }
  });
  const { valid, errors } = validateTournamentResult(result);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('source.completeness')));
});

test('H: unsupported source.type value is rejected', () => {
  const result = createTournamentResult({
    tournamentId: 't1', name: 'X', date: '2026-01-01', discipline: '8-Ball',
    standings: [], source: { type: 'telepathy', completeness: 'full' }
  });
  const { valid, errors } = validateTournamentResult(result);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('source.type')));
});

test('H: duplicate playerId within standings is rejected', () => {
  const result = createTournamentResult({
    tournamentId: 't1', name: 'X', date: '2026-01-01', discipline: '8-Ball',
    standings: [
      createStandingsRow({ placement: 1, playerId: 'dup', player: 'A', matchPoints: 5 }),
      createStandingsRow({ placement: 2, playerId: 'dup', player: 'B', matchPoints: 3 })
    ],
    source: { type: 'native', completeness: 'full' }
  });
  const { valid, errors } = validateTournamentResult(result);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('duplicates playerId')));
});

test('H: an invalid (non-positive / non-integer) placement is rejected', () => {
  const result = createTournamentResult({
    tournamentId: 't1', name: 'X', date: '2026-01-01', discipline: '8-Ball',
    standings: [createStandingsRow({ placement: 0, player: 'A', matchPoints: 5 })],
    source: { type: 'native', completeness: 'full' }
  });
  assert.equal(validateTournamentResult(result).valid, false);

  const resultFloat = createTournamentResult({
    tournamentId: 't2', name: 'X', date: '2026-01-01', discipline: '8-Ball',
    standings: [createStandingsRow({ placement: 1.5, player: 'A', matchPoints: 5 })],
    source: { type: 'native', completeness: 'full' }
  });
  assert.equal(validateTournamentResult(resultFloat).valid, false);
});

test('H: a malformed importedContributions value (non-numeric) is rejected', () => {
  const result = createTournamentResult({
    tournamentId: 't1', name: 'X', date: '2026-01-01', discipline: '8-Ball',
    standings: [],
    importedContributions: [createImportedContributionRow({ player: 'A', byCompetition: { 'c1': 'a lot' } })],
    source: { type: 'native', completeness: 'full' }
  });
  const { valid, errors } = validateTournamentResult(result);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('byCompetition["c1"]')));
});

test('H: a duplicate importedContributions row for the same player is rejected', () => {
  const result = createTournamentResult({
    tournamentId: 't1', name: 'X', date: '2026-01-01', discipline: '8-Ball',
    standings: [],
    importedContributions: [
      createImportedContributionRow({ player: 'A', byCompetition: { c1: 10 } }),
      createImportedContributionRow({ player: 'A', byCompetition: { c2: 20 } })
    ],
    source: { type: 'native', completeness: 'full' }
  });
  const { valid, errors } = validateTournamentResult(result);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('duplicates a contribution row')));
});

test('sanity: the exported closed lists match what validateTournamentResult actually enforces', () => {
  assert.deepEqual(SOURCE_TYPES, ['native', 'csv', 'manual']);
  assert.deepEqual(COMPLETENESS_LEVELS, ['full', 'standings', 'legacy-contribution']);
});
