// Vereinsmeisterschaft 2026 — the real series configuration (RACK HUB
// PLATFORM — PHASE 2). Pure data, built entirely from the generic
// seriesModel.js primitives — nothing VM-2026-specific exists in that
// module itself (see its own header's "Vereinsmeisterschaft 2026 must be
// EXPRESSIBLE through this generic shape via configuration alone").
//
// INVENTORY (see the Phase 2 report for the full repo-wide search): only
// 3 of these 7 tournaments have ANY historical data in this repository —
// `vm2026-9ball-1`, `vm2026-10ball-1`, `vm2026-14-1` (see
// tests/fixtures/historical/vm-joes-{9-ball,10-ball,14-1}/ and
// legacy/reference_vm_joes_*.csv). The other 4
// (`vm2026-8ball-1`/`vm2026-8ball-2`/`vm2026-9ball-2`/`vm2026-10ball-2`)
// are represented here as PLACEHOLDER slots only — their tournamentId and
// discipline are real/stable, but no name, date, or result data for them
// exists anywhere in this codebase. Nothing about them is invented beyond
// the id/discipline the Series structure itself requires to exist at all.
//
// This module defines STRUCTURE only — no TournamentResult data lives
// here. See src/series/vm2026HistoricalResults.js for the 3 real
// normalized results, and src/series/vm2026PlayerAliases.js for the
// canonical player mapping across them.

import { createSeriesCompetition, createSeriesDefinition, createSeriesTournamentRef } from '../domain/seriesModel.js';

// Real tournamentIds used throughout this phase's tests/normalizers —
// kept as named exports so no other module has to retype/risk drifting
// from these exact strings.
export const VM2026_TOURNAMENT_IDS = {
  EIGHT_BALL_1: 'vm2026-8ball-1',
  EIGHT_BALL_2: 'vm2026-8ball-2',
  NINE_BALL_1: 'vm2026-9ball-1', // REAL — tests/fixtures/historical/vm-joes-9-ball/
  NINE_BALL_2: 'vm2026-9ball-2',
  TEN_BALL_1: 'vm2026-10ball-1', // REAL — tests/fixtures/historical/vm-joes-10-ball/
  TEN_BALL_2: 'vm2026-10ball-2',
  FOURTEEN_ONE: 'vm2026-14-1' // REAL — tests/fixtures/historical/vm-joes-14-1/
};

// `name` is a clear, honest placeholder (not an invented event title) for
// the 4 slots with no historical data at all. The 3 real slots use the
// REAL names from their metadata.json.
export const vm2026Tournaments = () => [
  createSeriesTournamentRef({ tournamentId: VM2026_TOURNAMENT_IDS.EIGHT_BALL_1, discipline: '8-Ball', name: 'UNKNOWN — no historical data available' }),
  createSeriesTournamentRef({ tournamentId: VM2026_TOURNAMENT_IDS.EIGHT_BALL_2, discipline: '8-Ball', name: 'UNKNOWN — no historical data available' }),
  createSeriesTournamentRef({ tournamentId: VM2026_TOURNAMENT_IDS.NINE_BALL_1, discipline: '9-Ball', name: '9-Ball VM 2026 - Part 1' }),
  createSeriesTournamentRef({ tournamentId: VM2026_TOURNAMENT_IDS.NINE_BALL_2, discipline: '9-Ball', name: 'UNKNOWN — no historical data available' }),
  createSeriesTournamentRef({ tournamentId: VM2026_TOURNAMENT_IDS.TEN_BALL_1, discipline: '10-Ball', name: 'VM 10-Ball - Part 1' }),
  createSeriesTournamentRef({ tournamentId: VM2026_TOURNAMENT_IDS.TEN_BALL_2, discipline: '10-Ball', name: 'UNKNOWN — no historical data available' }),
  createSeriesTournamentRef({ tournamentId: VM2026_TOURNAMENT_IDS.FOURTEEN_ONE, discipline: '14.1', name: '14.1 VM 2026' })
];

export const VM2026_PRESTIGE_COMPETITION_ID = 'vm2026-overall-prestige';
export const VM2026_8BALL_RANK_COMPETITION_ID = 'vm2026-8ball-rank';
export const VM2026_9BALL_RANK_COMPETITION_ID = 'vm2026-9ball-rank';
export const VM2026_10BALL_RANK_COMPETITION_ID = 'vm2026-10ball-rank';

export const vm2026Competitions = () => [
  // All 7 tournaments feed the overall Prestige competition — this is
  // what makes "Master of the Joe's" possible, including the standalone
  // 14.1 event (section 4/9: 14.1 contributes to Prestige without ever
  // belonging to a discipline Rank competition).
  createSeriesCompetition({
    id: VM2026_PRESTIGE_COMPETITION_ID,
    name: "Master of the Joe's",
    type: 'prestige',
    tournamentIds: Object.values(VM2026_TOURNAMENT_IDS),
    // No Prestige formula has been confirmed for the generic platform yet
    // — see the Phase 2 report's terminology map. 'method' names an
    // AS-YET-UNREGISTERED policy; resolveTournamentContribution() reports
    // any player without an explicit importedContributions override as
    // unresolved rather than guessing (see seriesScoring.js).
    scoringConfig: { method: 'vm2026-prestige-unconfirmed', params: {} },
    awardConfig: { title: "Master of the Joe's", medalPositions: 1 }
  }),
  createSeriesCompetition({
    id: VM2026_8BALL_RANK_COMPETITION_ID,
    name: '8-Ball Rank',
    type: 'rank',
    tournamentIds: [VM2026_TOURNAMENT_IDS.EIGHT_BALL_1, VM2026_TOURNAMENT_IDS.EIGHT_BALL_2],
    scoringConfig: { method: 'vm2026-rank-unconfirmed', params: {} },
    awardConfig: { medalPositions: 3 }
  }),
  createSeriesCompetition({
    id: VM2026_9BALL_RANK_COMPETITION_ID,
    name: '9-Ball Rank',
    type: 'rank',
    tournamentIds: [VM2026_TOURNAMENT_IDS.NINE_BALL_1, VM2026_TOURNAMENT_IDS.NINE_BALL_2],
    scoringConfig: { method: 'vm2026-rank-unconfirmed', params: {} },
    awardConfig: { medalPositions: 3 }
  }),
  createSeriesCompetition({
    id: VM2026_10BALL_RANK_COMPETITION_ID,
    name: '10-Ball Rank',
    type: 'rank',
    tournamentIds: [VM2026_TOURNAMENT_IDS.TEN_BALL_1, VM2026_TOURNAMENT_IDS.TEN_BALL_2],
    scoringConfig: { method: 'vm2026-rank-unconfirmed', params: {} },
    awardConfig: { medalPositions: 3 }
  })
  // Deliberately NO 14.1 Rank competition (section 4/9) — this is
  // configuration ABSENCE, not an `if (discipline === '14.1')` special
  // case anywhere in seriesModel.js/seriesScoring.js. 14.1 still has its
  // OWN tournament-level podium (Top 3 medals) — that lives on the
  // TournamentResult/standings of the single 14.1 event itself, never on
  // the Series layer, since a single tournament's own placement is not a
  // Series concept at all.
];

export const vm2026Series = () => createSeriesDefinition({
  id: 'vm2026',
  name: 'Vereinsmeisterschaft 2026',
  season: '2026',
  tournaments: vm2026Tournaments(),
  competitions: vm2026Competitions()
});
