// SeriesDefinition / SeriesCompetition — pure, serializable description of
// a tournament SERIES (e.g. Vereinsmeisterschaft 2026) and the
// competitions scored across it (an overall Prestige competition, a
// per-discipline Rank competition, ...).
//
// ARCHITECTURAL RULE (RACK HUB PLATFORM — PHASE 1): Series concepts never
// live inside a Tournament/TournamentResult object, and a Series never
// reaches back into live tournament state:
//   Tournament  -> PRODUCES -> TournamentResult (tournamentResult.js)
//   Series      -> CONSUMES -> TournamentResult[] (by tournamentId reference)
// A SeriesDefinition only ever REFERENCES tournaments by id; it never
// embeds a TournamentResult inline, so updating/re-importing a result
// never requires touching the series definition itself.
//
// Vereinsmeisterschaft 2026 must be EXPRESSIBLE through this generic
// shape via configuration alone — see tests/series-model.test.js for the
// full 7-tournament VM2026 definition. Nothing VM-2026-specific is
// hardcoded into any function in this module.
//
// Pure: no React, no localStorage, no DOM/browser APIs, no classes, no
// Map/Set, no functions stored as data — same discipline tournamentModel.js
// and tournamentResult.js already establish. `scoringConfig`/`awardConfig`
// below are plain, JSON-safe DESCRIPTORS (a string `method` key + opaque
// `params`), never actual function references — see seriesScoring.js for
// the (application-layer) registry that resolves a `method` key to a real
// scoring function at evaluation time. This module only validates shape,
// never computes a score.
//
// =============================================================================
// SHAPES
// =============================================================================
//
// SeriesTournamentRef
// --------------------
//   { tournamentId, discipline, name }
// The minimal reference a series needs to (a) validate that every
// competition's tournamentIds actually belong to the series, and (b) know
// which discipline each tournament belongs to, without embedding that
// tournament's actual TournamentResult.
//
// SeriesCompetition
// ------------------
//   {
//     id,
//     name,
//     type: 'prestige' | 'rank',
//     tournamentIds: [tournamentId, ...],   // subset of the series' own
//                                             // tournaments — see
//                                             // validateSeriesDefinition()
//     scoringConfig: { method, params },     // `method` is a string key a
//                                              // policy registry resolves
//                                              // (see seriesScoring.js);
//                                              // `params` is opaque,
//                                              // policy-specific
//                                              // configuration this module
//                                              // never interprets
//     awardConfig: { title, medalPositions }  // e.g. { title: "Master of
//                                               // the Joe's", medalPositions: 1 }
//                                               // or { medalPositions: 3 }
//                                               // for a Top-3 Rank
//                                               // competition — both
//                                               // fields optional/opaque
//                                               // display config, not
//                                               // scoring logic
//   }
//
// SeriesDefinition
// -----------------
//   {
//     id,
//     name,
//     season,
//     tournaments: [SeriesTournamentRef],
//     competitions: [SeriesCompetition]
//   }

export const COMPETITION_TYPES = ['prestige', 'rank'];

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

export const createSeriesTournamentRef = ({ tournamentId, discipline, name }) => ({ tournamentId, discipline, name });

export const createSeriesCompetition = ({ id, name, type, tournamentIds = [], scoringConfig, awardConfig }) => ({
  id,
  name,
  type,
  tournamentIds,
  scoringConfig,
  awardConfig
});

export const createSeriesDefinition = ({ id, name, season, tournaments = [], competitions = [] }) => ({
  id,
  name,
  season,
  tournaments,
  competitions
});

// Lightweight structural validation (section 7): duplicate tournament IDs
// within the series, a competition referencing a tournament the series
// doesn't contain, duplicate competition IDs, and unsupported competition
// `type` values. Deliberately does not validate `scoringConfig.method`
// against a registry of known policies — that resolution is
// seriesScoring.js's job at evaluation time, not this module's job at
// definition time (a series can be defined before every scoring method it
// references has been implemented).
export const validateSeriesDefinition = (series) => {
  const errors = [];

  if (!isPlainObject(series)) return { valid: false, errors: ['SeriesDefinition must be a plain object'] };

  if (typeof series.id !== 'string' || series.id.trim() === '') errors.push('id is required and must be a non-empty string');
  if (typeof series.name !== 'string' || series.name.trim() === '') errors.push('name is required and must be a non-empty string');

  const knownTournamentIds = new Set();
  if (!Array.isArray(series.tournaments)) {
    errors.push('tournaments must be an array');
  } else {
    series.tournaments.forEach((t, i) => {
      if (!isPlainObject(t) || typeof t.tournamentId !== 'string' || t.tournamentId.trim() === '') {
        errors.push(`tournaments[${i}] must have a non-empty tournamentId`);
        return;
      }
      if (knownTournamentIds.has(t.tournamentId)) errors.push(`tournaments[${i}] duplicates tournamentId "${t.tournamentId}"`);
      knownTournamentIds.add(t.tournamentId);
    });
  }

  if (!Array.isArray(series.competitions)) {
    errors.push('competitions must be an array');
  } else {
    const seenCompetitionIds = new Set();
    series.competitions.forEach((c, i) => {
      if (!isPlainObject(c)) { errors.push(`competitions[${i}] must be an object`); return; }
      if (typeof c.id !== 'string' || c.id.trim() === '') {
        errors.push(`competitions[${i}] must have a non-empty id`);
      } else {
        if (seenCompetitionIds.has(c.id)) errors.push(`competitions[${i}] duplicates competition id "${c.id}"`);
        seenCompetitionIds.add(c.id);
      }
      if (!COMPETITION_TYPES.includes(c.type)) {
        errors.push(`competitions[${i}].type must be one of ${COMPETITION_TYPES.join(', ')} (got "${c.type}")`);
      }
      if (!Array.isArray(c.tournamentIds) || c.tournamentIds.length === 0) {
        errors.push(`competitions[${i}].tournamentIds must be a non-empty array`);
      } else {
        c.tournamentIds.forEach((tid) => {
          if (!knownTournamentIds.has(tid)) {
            errors.push(`competitions[${i}] references unknown tournamentId "${tid}" (not in series.tournaments)`);
          }
        });
      }
      if (!isPlainObject(c.scoringConfig) || typeof c.scoringConfig.method !== 'string' || c.scoringConfig.method.trim() === '') {
        errors.push(`competitions[${i}].scoringConfig.method is required and must be a non-empty string`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
};
