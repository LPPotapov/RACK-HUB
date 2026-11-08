// Vereinsmeisterschaft 2026 — canonical player identity for the 3 real
// historical events (RACK HUB PLATFORM — PHASE 2, section 5).
//
// METHOD: every player name was cross-referenced EXACTLY (byte-for-byte
// string match) across the three real fixtures
// (tests/fixtures/historical/vm-joes-{9-ball,10-ball,14-1}/). 16 distinct
// people play in 2 or more of the 3 events, always under the IDENTICAL
// spelling in every event they appear in. Every alias row below reflects
// that exact-match cross-reference — no fuzzy/approximate matching was
// used or is needed here (see playerIdentity.js's own "no fuzzy matching"
// rule).
//
// SPELLING-DISCREPANCY FINDING (section 5's explicit "report them" ask):
// NONE found. The only name collisions across the 3 fixtures that are
// NOT the same person are family members sharing a surname with
// DIFFERENT first names — "Greta Dahlmann"/"Thomas Dahlmann"/"Viktoria
// Dahlmann", "Henry Heim"/"Paul Samuel Heim", "Janoš Nuck"/"Michael
// Nuck" — these are correctly kept as separate people (no alias row
// merges them) and are not a spelling problem at all.
//
// Players appearing in only ONE of the 3 real events have no alias row
// here — there is no cross-event ambiguity to resolve for them yet, and
// playerIdentity.js's resolveCanonicalPlayerId() simply returns null for
// them (not an error) until/unless they turn up in a future event too.

import { createPlayerAlias } from '../domain/playerIdentity.js';
import { VM2026_TOURNAMENT_IDS } from './vm2026.js';

const { NINE_BALL_1, TEN_BALL_1, FOURTEEN_ONE } = VM2026_TOURNAMENT_IDS;

// [canonicalPlayerId, name, [tournamentIds the name appears in]] — derived
// directly from the exact-match cross-reference described above.
const MULTI_EVENT_PLAYERS = [
  ['vm-player-anton-schoenberger', 'Anton Schönberger', [NINE_BALL_1, TEN_BALL_1]],
  ['vm-player-carsten-gaebler', 'Carsten Gäbler', [NINE_BALL_1, TEN_BALL_1, FOURTEEN_ONE]],
  ['vm-player-greta-dahlmann', 'Greta Dahlmann', [NINE_BALL_1, TEN_BALL_1]],
  ['vm-player-henry-heim', 'Henry Heim', [NINE_BALL_1, TEN_BALL_1, FOURTEEN_ONE]],
  ['vm-player-henry-zieger', 'Henry Zieger', [NINE_BALL_1, TEN_BALL_1, FOURTEEN_ONE]],
  ['vm-player-janos-nuck', 'Janoš Nuck', [TEN_BALL_1, FOURTEEN_ONE]],
  ['vm-player-leonid-potapov', 'Leonid Potapov', [NINE_BALL_1, TEN_BALL_1, FOURTEEN_ONE]],
  ['vm-player-paul-samuel-heim', 'Paul Samuel Heim', [NINE_BALL_1, TEN_BALL_1, FOURTEEN_ONE]],
  ['vm-player-paul-weissbach', 'Paul Weißbach', [NINE_BALL_1, TEN_BALL_1, FOURTEEN_ONE]],
  ['vm-player-quang-anh-tran', 'Quang Anh Tran', [NINE_BALL_1, TEN_BALL_1, FOURTEEN_ONE]],
  ['vm-player-renato-tupas', 'Renato Tupas', [NINE_BALL_1, TEN_BALL_1]],
  ['vm-player-richard-juros', 'Richard Juros', [NINE_BALL_1, TEN_BALL_1, FOURTEEN_ONE]],
  ['vm-player-roberto-stephan', 'Roberto Stephan', [NINE_BALL_1, TEN_BALL_1]],
  ['vm-player-sebastian-bellmann', 'Sebastian Bellmann', [NINE_BALL_1, TEN_BALL_1]],
  ['vm-player-thomas-dahlmann', 'Thomas Dahlmann', [NINE_BALL_1, TEN_BALL_1]],
  ['vm-player-uwe-draeger', 'Uwe Draeger', [NINE_BALL_1, TEN_BALL_1]]
];

export const vm2026PlayerAliases = () =>
  MULTI_EVENT_PLAYERS.flatMap(([canonicalPlayerId, sourceName, tournamentIds]) =>
    tournamentIds.map((tournamentId) => createPlayerAlias({ canonicalPlayerId, tournamentId, sourceName }))
  );
