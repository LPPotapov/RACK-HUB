// RACK HUB PLATFORM — PHASE 1: SeriesDefinition/SeriesCompetition (tests
// section 8 D/E/F/G/H). Builds the REAL Vereinsmeisterschaft 2026 series
// shape — 7 tournaments, one overall Prestige competition across all 7,
// three 2-tournament Rank competitions (8-Ball/9-Ball/10-Ball), and a
// standalone 14.1 event that feeds Prestige only — entirely through
// configuration, proving no VM-2026-specific logic needs to exist in
// seriesModel.js itself.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSeriesCompetition,
  createSeriesDefinition,
  createSeriesTournamentRef,
  validateSeriesDefinition
} from '../src/domain/seriesModel.js';

// The 7 real VM2026 tournaments (3 of these — 9-ball/10-ball/14.1 — are the
// SAME events the real historical fixtures under tests/fixtures/historical/
// represent; 8-ball x2 and the second 9-ball/10-ball legs are represented
// here as their own tournamentIds even though no fixture exists for them
// yet — a Series only ever needs a tournamentId reference, never the
// TournamentResult itself, so this is a complete and valid series
// definition regardless of which results have actually been imported).
const vm2026Tournaments = () => [
  createSeriesTournamentRef({ tournamentId: 'vm2026-8ball-1', discipline: '8-Ball', name: '8-Ball VM 2026 — Part 1' }),
  createSeriesTournamentRef({ tournamentId: 'vm2026-8ball-2', discipline: '8-Ball', name: '8-Ball VM 2026 — Part 2' }),
  createSeriesTournamentRef({ tournamentId: 'vm2026-9ball-1', discipline: '9-Ball', name: '9-Ball VM 2026 — Part 1' }),
  createSeriesTournamentRef({ tournamentId: 'vm2026-9ball-2', discipline: '9-Ball', name: '9-Ball VM 2026 — Part 2' }),
  createSeriesTournamentRef({ tournamentId: 'vm2026-10ball-1', discipline: '10-Ball', name: '10-Ball VM 2026 — Part 1' }),
  createSeriesTournamentRef({ tournamentId: 'vm2026-10ball-2', discipline: '10-Ball', name: '10-Ball VM 2026 — Part 2' }),
  createSeriesTournamentRef({ tournamentId: 'vm2026-14-1', discipline: '14.1', name: '14.1 VM 2026' })
];

const allTournamentIds = (tournaments) => tournaments.map((t) => t.tournamentId);

const vm2026Series = () => {
  const tournaments = vm2026Tournaments();
  return createSeriesDefinition({
    id: 'vm2026',
    name: 'Vereinsmeisterschaft 2026',
    season: '2026',
    tournaments,
    competitions: [
      createSeriesCompetition({
        id: 'vm2026-overall-prestige',
        name: "Master of the Joe's",
        type: 'prestige',
        tournamentIds: allTournamentIds(tournaments), // ALL 7 — section 4
        scoringConfig: { method: 'tbd-prestige-formula', params: {} },
        awardConfig: { title: "Master of the Joe's", medalPositions: 1 }
      }),
      createSeriesCompetition({
        id: 'vm2026-8ball-rank',
        name: '8-Ball Rank',
        type: 'rank',
        tournamentIds: ['vm2026-8ball-1', 'vm2026-8ball-2'],
        scoringConfig: { method: 'tbd-rank-formula', params: {} },
        awardConfig: { medalPositions: 3 }
      }),
      createSeriesCompetition({
        id: 'vm2026-9ball-rank',
        name: '9-Ball Rank',
        type: 'rank',
        tournamentIds: ['vm2026-9ball-1', 'vm2026-9ball-2'],
        scoringConfig: { method: 'tbd-rank-formula', params: {} },
        awardConfig: { medalPositions: 3 }
      }),
      createSeriesCompetition({
        id: 'vm2026-10ball-rank',
        name: '10-Ball Rank',
        type: 'rank',
        tournamentIds: ['vm2026-10ball-1', 'vm2026-10ball-2'],
        scoringConfig: { method: 'tbd-rank-formula', params: {} },
        awardConfig: { medalPositions: 3 }
      })
      // Deliberately NO 14.1 Rank competition — section 4: "no multi-event
      // discipline Rank competition required" for 14.1. It still appears
      // in `tournaments` and in the overall Prestige competition's
      // tournamentIds above.
    ]
  });
};

// ---------------------------------------------------------------------------
// D. a Series can contain 7 events
// ---------------------------------------------------------------------------

test('D: the VM2026 series contains exactly 7 tournaments', () => {
  const series = vm2026Series();
  assert.equal(series.tournaments.length, 7);
  assert.deepEqual(validateSeriesDefinition(series).errors, []);
});

// ---------------------------------------------------------------------------
// E. all 7 can feed Prestige
// ---------------------------------------------------------------------------

test('E: the overall Prestige competition references all 7 tournaments', () => {
  const series = vm2026Series();
  const prestige = series.competitions.find((c) => c.id === 'vm2026-overall-prestige');
  assert.equal(prestige.type, 'prestige');
  assert.equal(prestige.tournamentIds.length, 7);
  assert.deepEqual(new Set(prestige.tournamentIds), new Set(series.tournaments.map((t) => t.tournamentId)));
});

// ---------------------------------------------------------------------------
// F. only selected 8/9/10-Ball events feed their respective Rank competitions
// ---------------------------------------------------------------------------

test('F: each discipline Rank competition references ONLY its own 2 tournaments, never the other disciplines or 14.1', () => {
  const series = vm2026Series();
  const byId = Object.fromEntries(series.competitions.map((c) => [c.id, c]));

  assert.deepEqual(byId['vm2026-8ball-rank'].tournamentIds, ['vm2026-8ball-1', 'vm2026-8ball-2']);
  assert.deepEqual(byId['vm2026-9ball-rank'].tournamentIds, ['vm2026-9ball-1', 'vm2026-9ball-2']);
  assert.deepEqual(byId['vm2026-10ball-rank'].tournamentIds, ['vm2026-10ball-1', 'vm2026-10ball-2']);

  ['vm2026-8ball-rank', 'vm2026-9ball-rank', 'vm2026-10ball-rank'].forEach((id) => {
    assert.ok(!byId[id].tournamentIds.includes('vm2026-14-1'), `${id} must not reference the standalone 14.1 event`);
  });
});

// ---------------------------------------------------------------------------
// G. 14.1 belongs to the Series and Prestige while not belonging to a Rank
// competition.
// ---------------------------------------------------------------------------

test('G: 14.1 is a series member and feeds Prestige, but is not referenced by ANY Rank competition', () => {
  const series = vm2026Series();
  assert.ok(series.tournaments.some((t) => t.tournamentId === 'vm2026-14-1'));

  const prestige = series.competitions.find((c) => c.type === 'prestige');
  assert.ok(prestige.tournamentIds.includes('vm2026-14-1'));

  const rankCompetitions = series.competitions.filter((c) => c.type === 'rank');
  rankCompetitions.forEach((c) => {
    assert.ok(!c.tournamentIds.includes('vm2026-14-1'));
  });
  assert.equal(rankCompetitions.length, 3, 'exactly 3 Rank competitions (8/9/10-Ball) — no 14.1 Rank competition exists');
});

// ---------------------------------------------------------------------------
// H (series-level slice): malformed tournament/competition references are
// rejected.
// ---------------------------------------------------------------------------

test('H: duplicate tournamentIds within a series are rejected', () => {
  const series = createSeriesDefinition({
    id: 's1', name: 'Broken Series', season: '2026',
    tournaments: [
      createSeriesTournamentRef({ tournamentId: 'dup', discipline: '8-Ball', name: 'A' }),
      createSeriesTournamentRef({ tournamentId: 'dup', discipline: '9-Ball', name: 'B' })
    ],
    competitions: []
  });
  const { valid, errors } = validateSeriesDefinition(series);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('duplicates tournamentId')));
});

test('H: a competition referencing an unknown tournamentId is rejected', () => {
  const series = createSeriesDefinition({
    id: 's1', name: 'Broken Series', season: '2026',
    tournaments: [createSeriesTournamentRef({ tournamentId: 't1', discipline: '8-Ball', name: 'A' })],
    competitions: [
      createSeriesCompetition({
        id: 'c1', name: 'Bad Competition', type: 'rank',
        tournamentIds: ['t1', 'does-not-exist'],
        scoringConfig: { method: 'whatever', params: {} }
      })
    ]
  });
  const { valid, errors } = validateSeriesDefinition(series);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('references unknown tournamentId "does-not-exist"')));
});

test('H: duplicate competition ids are rejected', () => {
  const tournaments = [createSeriesTournamentRef({ tournamentId: 't1', discipline: '8-Ball', name: 'A' })];
  const series = createSeriesDefinition({
    id: 's1', name: 'Broken Series', season: '2026',
    tournaments,
    competitions: [
      createSeriesCompetition({ id: 'dup', name: 'A', type: 'rank', tournamentIds: ['t1'], scoringConfig: { method: 'm', params: {} } }),
      createSeriesCompetition({ id: 'dup', name: 'B', type: 'prestige', tournamentIds: ['t1'], scoringConfig: { method: 'm', params: {} } })
    ]
  });
  const { valid, errors } = validateSeriesDefinition(series);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('duplicates competition id')));
});

test('H: an unsupported competition type is rejected', () => {
  const tournaments = [createSeriesTournamentRef({ tournamentId: 't1', discipline: '8-Ball', name: 'A' })];
  const series = createSeriesDefinition({
    id: 's1', name: 'Broken Series', season: '2026',
    tournaments,
    competitions: [
      createSeriesCompetition({ id: 'c1', name: 'A', type: 'popularity-contest', tournamentIds: ['t1'], scoringConfig: { method: 'm', params: {} } })
    ]
  });
  const { valid, errors } = validateSeriesDefinition(series);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('competitions[0].type')));
});

test('H: a competition missing scoringConfig.method is rejected', () => {
  const tournaments = [createSeriesTournamentRef({ tournamentId: 't1', discipline: '8-Ball', name: 'A' })];
  const series = createSeriesDefinition({
    id: 's1', name: 'Broken Series', season: '2026',
    tournaments,
    competitions: [createSeriesCompetition({ id: 'c1', name: 'A', type: 'rank', tournamentIds: ['t1'], scoringConfig: {} })]
  });
  const { valid, errors } = validateSeriesDefinition(series);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('scoringConfig.method')));
});
