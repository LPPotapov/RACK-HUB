// TournamentResult — normalized, serializable representation of a single
// tournament's OUTCOME, independent of which engine produced it (fixed-rack
// BBS, GBR_14.1, or a future format) and independent of whether it came
// from native play or a historical import.
//
// This is the boundary the RACK HUB platform phase introduces between "a
// tournament" and "a tournament's result as an input to something else":
//   Tournament (tournamentModel.js) -> PRODUCES -> TournamentResult
//   Series (seriesModel.js)         -> CONSUMES -> TournamentResult[]
// A Series never reaches back into live Tournament/Canaletto state; it
// only ever sees already-finished TournamentResult objects. Canaletto Cup
// 2026 is NOT migrated onto this shape in this phase — this module is
// additive, alongside the existing implementation (see docs task "RACK HUB
// PLATFORM — PHASE 1").
//
// Pure: no React, no localStorage, no DOM/browser APIs, no classes, no
// Map/Set, no functions stored as data — same discipline tournamentModel.js
// already establishes. Every shape here must survive
// `JSON.parse(JSON.stringify(result))` unchanged.
//
// StandingsRow deliberately REUSES the field vocabulary this project
// already produces and tests for historical standings — see
// tests/fixtures/historical/vm-joes-9-ball/expected-final-table.json and
// tests/fixtures/historical/vm-joes-10-ball/expected-final-table.json
// (placement, player, matchPoints, prestige, eventScore, racksWon,
// racksLost, rackDifferential, averagePerf, startingGbr, finalGbr,
// gbrChange, roundResults) — this is NOT a new vocabulary invented for
// this phase, it is the one the M1 historical fixtures already settled on.
// createStandingsRow() only requires the handful of fields every
// completeness level can supply (placement, player identity, matchPoints)
// and passes everything else through unmodified — it does not enumerate
// or validate the full optional field set, matching this project's
// existing "do not overengineer schemas" standard (see
// validateTournamentState()'s own comment in tournamentModel.js).
//
// =============================================================================
// SHAPES
// =============================================================================
//
// Participant
// -----------
//   { playerId, name }
// `playerId` is a CANONICAL player identity reference (see
// playerIdentity.js) — not necessarily the same value as any single
// tournament's own internal roster id (Canaletto's block roster ids, for
// example, are scoped to that one event and are never guaranteed stable
// across tournaments). `playerId` is OPTIONAL here: a freshly-imported
// historical result may not have one assigned yet (see
// resolveCanonicalPlayerId() in playerIdentity.js) — `name` is always
// required and always audit-visible even once a canonical id exists,
// exactly like the historical fixtures already keep `player` (display
// name) alongside computed values.
//
// StandingsRow
// ------------
//   {
//     placement,       // 1-based final position; ties MAY legitimately
//                       // share a placement value — this module does not
//                       // assume strict uniqueness
//     playerId,         // optional, see Participant above
//     player,           // display name — REQUIRED (always audit-visible)
//     matchPoints,       // REQUIRED — the one score every completeness
//                         // level is expected to carry
//     ...rest             // anything else (racksWon, racksLost,
//                          // rackDifferential, averagePerf, startingGbr,
//                          // finalGbr, gbrChange, prestige, eventScore,
//                          // roundResults, games, ...) passed through
//                          // verbatim, never enumerated/required here
//   }
//
// TournamentResult
// -----------------
//   {
//     tournamentId,       // stable id within its series/registry — REQUIRED
//     name,
//     date,                // ISO date string
//     discipline,           // free string ('8-Ball'/'9-Ball'/'10-Ball'/'14.1'/...),
//                            // deliberately NOT enum-locked — the platform
//                            // must support disciplines Canaletto itself
//                            // doesn't know about yet
//     participants: [Participant],
//     standings: [StandingsRow] | null,
//                           // null ONLY when source.completeness is
//                           // 'legacy-contribution' (see below) — every
//                           // other completeness level requires a real
//                           // (possibly empty) standings array
//     matches,              // OPTIONAL — only meaningful/expected for
//                            // source.completeness === 'full'; this module
//                            // does not define a canonical Match shape of
//                            // its own, it only carries whatever match
//                            // history a 'full' producer supplies
//                            // (e.g. tournamentModel.js's own Match shape,
//                            // or a historical fixture's matches.json rows)
//     importedContributions,  // OPTIONAL: [ImportedContributionRow] — see
//                              // below. An imported contribution is NEVER
//                              // silently inferred from standings; it is
//                              // only ever read when a Series explicitly
//                              // asks for it (see seriesScoring.js).
//     source: {
//       type: 'native' | 'csv' | 'manual',
//       completeness: 'full' | 'standings' | 'legacy-contribution'
//     }
//   }
//
// ImportedContributionRow
// ------------------------
//   { playerId, player, byCompetition: { [competitionId]: number } }
//
// PHASE 2 CORRECTION (two ambiguities found while validating this shape
// against the real VM2026 Vereinsmeisterschaft data — see the Phase 2
// report for the full reasoning):
//
//   1. "which competition" — the original Phase 1 shape keyed overrides
//      by COMPETITION TYPE (`{ prestige?, rank? }`). That is ambiguous the
//      moment a tournament could belong to two competitions of the SAME
//      type (two different 'rank' competitions, say), or whenever the
//      override rule genuinely differs per competition even at the same
//      type. Overrides are now keyed by the competition's own `id`
//      (`byCompetition: { [competitionId]: number }`), so an override
//      always identifies EXACTLY which competition it applies to and can
//      never bleed into a different one it was never meant for.
//
//   2. "per tournament vs per player" — Prestige/Rank are fundamentally
//      PER-PLAYER contributions (a Series ranks people, not events). A
//      single scalar per tournament cannot represent "we only know 3 of
//      22 players' historical contribution for this event, not the rest"
//      — a completely realistic legacy-import situation. Imported
//      contributions are therefore a LIST of per-player rows, each
//      identifying its player (by `playerId` once known, always by the
//      audit-visible `player` display name) and its own
//      `byCompetition` map — never a single tournament-wide number.
//
// A `legacy-contribution` TournamentResult's `importedContributions` need
// not cover every participant — only the players whose historical
// contribution is actually known survive as rows; anyone else is simply
// absent (never defaulted to 0 — see validateTournamentResult()).
//
// completeness meanings:
//   full                 — native/complete: participants + standings, and
//                           typically full match history (source.type
//                           usually 'native', e.g. a finished Canaletto
//                           tournament once a future adapter projects it
//                           onto this shape — not built in this phase).
//   standings            — historical import with final standings/
//                           placement but no reconstructible match history
//                           (exactly the vm-joes-9-ball/10-ball shape).
//   legacy-contribution  — even standings-level detail is insufficient;
//                           `standings` is null and `importedContributions`
//                           MUST supply at least one of prestige/rank
//                           instead — see validateTournamentResult().

export const SOURCE_TYPES = ['native', 'csv', 'manual'];
export const COMPLETENESS_LEVELS = ['full', 'standings', 'legacy-contribution'];

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

export const createParticipant = ({ playerId = null, name }) => ({ playerId, name });

// An ImportedContributionRow — see the module header. `byCompetition` maps
// a SeriesCompetition's own `id` to the explicit, authoritative value this
// player's result contributes to it.
export const createImportedContributionRow = ({ playerId = null, player, byCompetition = {} }) => ({
  playerId,
  player,
  byCompetition
});

// Only the fields every completeness level is expected to supply are named
// parameters; everything else passes through via `...rest` untouched — see
// the module header for why this deliberately does not enumerate the full
// historical-fixture field set.
export const createStandingsRow = ({ placement, playerId = null, player, matchPoints, ...rest }) => ({
  placement,
  playerId,
  player,
  matchPoints,
  ...rest
});

export const createTournamentResult = ({
  tournamentId,
  name,
  date,
  discipline,
  participants = [],
  standings = null,
  matches,
  importedContributions,
  source
}) => ({
  tournamentId,
  name,
  date,
  discipline,
  participants,
  standings,
  ...(matches !== undefined ? { matches } : {}),
  ...(importedContributions !== undefined ? { importedContributions } : {}),
  source
});

// Lightweight structural validation (section 7: duplicate player result
// rows, invalid places, malformed imported contributions, unsupported
// completeness/source values) — returns { valid, errors }, never throws,
// matching tournamentModel.js's own validateTournamentState() convention.
// Deliberately permissive about everything NOT explicitly checked here
// (StandingsRow's optional fields, discipline's exact string value, etc.)
// — see the module header's "do not overengineer schemas" note.
export const validateTournamentResult = (result) => {
  const errors = [];

  if (!isPlainObject(result)) return { valid: false, errors: ['TournamentResult must be a plain object'] };

  if (typeof result.tournamentId !== 'string' || result.tournamentId.trim() === '') errors.push('tournamentId is required and must be a non-empty string');
  if (typeof result.name !== 'string' || result.name.trim() === '') errors.push('name is required and must be a non-empty string');
  if (typeof result.date !== 'string' || result.date.trim() === '') errors.push('date is required and must be a non-empty string');
  if (typeof result.discipline !== 'string' || result.discipline.trim() === '') errors.push('discipline is required and must be a non-empty string');

  if (!Array.isArray(result.participants)) {
    errors.push('participants must be an array');
  } else {
    const seenPlayerIds = new Set();
    result.participants.forEach((p, i) => {
      if (!isPlainObject(p) || typeof p.name !== 'string' || p.name.trim() === '') {
        errors.push(`participants[${i}] must have a non-empty name`);
        return;
      }
      if (p.playerId != null) {
        if (seenPlayerIds.has(p.playerId)) errors.push(`participants[${i}] duplicates playerId "${p.playerId}"`);
        seenPlayerIds.add(p.playerId);
      }
    });
  }

  if (!isPlainObject(result.source)) {
    errors.push('source is required and must be an object');
  } else {
    if (!SOURCE_TYPES.includes(result.source.type)) {
      errors.push(`source.type must be one of ${SOURCE_TYPES.join(', ')} (got "${result.source.type}")`);
    }
    if (!COMPLETENESS_LEVELS.includes(result.source.completeness)) {
      errors.push(`source.completeness must be one of ${COMPLETENESS_LEVELS.join(', ')} (got "${result.source.completeness}")`);
    }
  }

  const completeness = isPlainObject(result.source) ? result.source.completeness : undefined;

  if (completeness === 'legacy-contribution') {
    if (result.standings !== null && result.standings !== undefined) {
      errors.push('standings must be null when source.completeness is "legacy-contribution"');
    }
    if (!Array.isArray(result.importedContributions) || result.importedContributions.length === 0) {
      errors.push('importedContributions must be a non-empty array when source.completeness is "legacy-contribution"');
    }
  } else if (completeness === 'full' || completeness === 'standings') {
    if (!Array.isArray(result.standings)) {
      errors.push(`standings must be an array when source.completeness is "${completeness}"`);
    }
  }

  if (Array.isArray(result.standings)) {
    const seenPlayerIds = new Set();
    result.standings.forEach((row, i) => {
      if (!isPlainObject(row)) { errors.push(`standings[${i}] must be an object`); return; }
      if (!Number.isInteger(row.placement) || row.placement < 1) errors.push(`standings[${i}].placement must be a positive integer`);
      if (typeof row.player !== 'string' || row.player.trim() === '') errors.push(`standings[${i}].player must be a non-empty string`);
      if (typeof row.matchPoints !== 'number' || !Number.isFinite(row.matchPoints)) errors.push(`standings[${i}].matchPoints must be a finite number`);
      if (row.playerId != null) {
        if (seenPlayerIds.has(row.playerId)) errors.push(`standings[${i}] duplicates playerId "${row.playerId}"`);
        seenPlayerIds.add(row.playerId);
      }
    });
  }

  if (result.importedContributions !== undefined) {
    if (!Array.isArray(result.importedContributions)) {
      errors.push('importedContributions must be an array when present');
    } else {
      const seenPlayerKeys = new Set();
      result.importedContributions.forEach((row, i) => {
        if (!isPlainObject(row)) { errors.push(`importedContributions[${i}] must be an object`); return; }
        if (typeof row.player !== 'string' || row.player.trim() === '') {
          errors.push(`importedContributions[${i}].player must be a non-empty string`);
        }
        const key = row.playerId != null ? String(row.playerId) : `name:${row.player}`;
        if (seenPlayerKeys.has(key)) errors.push(`importedContributions[${i}] duplicates a contribution row for the same player`);
        seenPlayerKeys.add(key);
        if (!isPlainObject(row.byCompetition) || Object.keys(row.byCompetition).length === 0) {
          errors.push(`importedContributions[${i}].byCompetition must be a non-empty object keyed by competition id`);
        } else {
          Object.entries(row.byCompetition).forEach(([competitionId, value]) => {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
              errors.push(`importedContributions[${i}].byCompetition["${competitionId}"] must be a finite number`);
            }
          });
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
};
