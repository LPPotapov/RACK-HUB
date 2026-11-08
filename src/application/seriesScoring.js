// Series scoring-policy BOUNDARY (RACK HUB PLATFORM — PHASE 1/2, section 5).
//
// We have NOT finalized the actual Prestige/Rank formulas for the generic
// platform yet. This module does not invent any — it defines the clean
// seam a real formula plugs into next, and the two pieces of behavior that
// ARE settled now:
//   1. an explicit, imported contribution always wins over a computed one
//      (section 5/8);
//   2. a contribution is resolved PER PLAYER, never as one undifferentiated
//      number for a whole tournament (Phase 2 correction — see
//      tournamentResult.js's module header for why: Prestige/Rank rank
//      people, not events, and a real legacy import may only know SOME
//      players' historical contribution for a given event, never "the"
//      single number for it).
//
// Lives in src/application/ (not src/domain/) deliberately: a scoring
// POLICY REGISTRY is a lookup table of functions, which cannot be plain
// JSON-serializable domain data (seriesModel.js's SeriesCompetition only
// ever stores the policy's string `method` key — see that module's
// header). This file is the orchestration layer that resolves a `method`
// key to an actual function and calls it; the registry itself is supplied
// by the caller, never hardcoded here, so adding a real formula later
// never requires touching this resolution logic.
//
// PRECEDENCE (section 5/8): an explicit `importedContributions` row's
// `byCompetition[competition.id]` value is ALWAYS authoritative for that
// ONE competition, for that ONE player, and is NEVER overridden by a
// computed value. "Explicit and auditable" always outranks "inferred" —
// this mirrors the exact same precedence rule the TV ticker fix
// established for official-vs-draft-vs-manual scores: an explicit
// human-supplied value never gets silently masked by something derived.
// Critically, an override for competition A's id must NEVER be read when
// resolving competition B, even if both reference the same player/
// tournament — see resolveTournamentContribution()'s keyed lookup below,
// and tests/series-scoring.test.js's "cannot accidentally override
// another competition" regression guard.
//
// A scoring policy function has the shape:
//   (standingsRow, tournamentResult, params) => number
// and is never called at all when an imported contribution already covers
// this (player, competition) pair.

const findImportedRow = (tournamentResult, playerRef) => {
  const rows = tournamentResult.importedContributions;
  if (!Array.isArray(rows)) return null;
  if (playerRef.playerId != null) {
    const byId = rows.find((r) => r.playerId === playerRef.playerId);
    if (byId) return byId;
  }
  return rows.find((r) => r.player === playerRef.player) || null;
};

const findStandingsRow = (tournamentResult, playerRef) => {
  if (!Array.isArray(tournamentResult.standings)) return null;
  if (playerRef.playerId != null) {
    const byId = tournamentResult.standings.find((r) => r.playerId === playerRef.playerId);
    if (byId) return byId;
  }
  return tournamentResult.standings.find((r) => r.player === playerRef.player) || null;
};

// Resolves what ONE PLAYER's result in ONE TournamentResult contributes to
// ONE SeriesCompetition, given a policy registry
// (`{ [method]: (standingsRow, tournamentResult, params) => number }`).
// `playerRef` is `{ playerId?, player }` — whatever identifies the person
// (matched by playerId when present, else by exact display name — no
// fuzzy matching, consistent with playerIdentity.js). Returns
// `{ ok: true, value, source }` or `{ ok: false, reason }` — never throws,
// and never guesses a number when it genuinely cannot produce one.
export const resolveTournamentContribution = (competition, tournamentResult, playerRef, policyRegistry = {}) => {
  const importedRow = findImportedRow(tournamentResult, playerRef);
  if (importedRow && importedRow.byCompetition[competition.id] !== undefined) {
    return { ok: true, value: importedRow.byCompetition[competition.id], source: 'imported' };
  }

  const standingsRow = findStandingsRow(tournamentResult, playerRef);
  if (!standingsRow) {
    return { ok: false, reason: `no standings row and no importedContributions override for player "${playerRef.player}" in tournament "${tournamentResult.tournamentId}" for competition "${competition.id}"` };
  }

  const method = competition.scoringConfig?.method;
  const policyFn = method && policyRegistry[method];
  if (typeof policyFn !== 'function') {
    return { ok: false, reason: `no scoring policy registered for method "${method}"` };
  }

  const value = policyFn(standingsRow, tournamentResult, competition.scoringConfig.params);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, reason: `scoring policy "${method}" did not return a finite number` };
  }
  return { ok: true, value, source: 'computed' };
};

// Resolves EVERY known player's contribution for ONE tournament a
// competition references — "known" meaning present in standings and/or
// importedContributions (participants alone, with neither, cannot be
// scored). Players present in standings with NO matching importedRow
// simply fall through to the computed path above; players present ONLY
// in importedContributions (the realistic legacy-contribution case — no
// standings survive at all) are still resolved via their override.
export const resolveTournamentContributionsForAllPlayers = (competition, tournamentResult, policyRegistry = {}) => {
  const byKey = new Map(); // dedupe key -> playerRef
  (tournamentResult.standings || []).forEach((row) => {
    byKey.set(row.playerId != null ? `id:${row.playerId}` : `name:${row.player}`, { playerId: row.playerId, player: row.player });
  });
  (tournamentResult.importedContributions || []).forEach((row) => {
    byKey.set(row.playerId != null ? `id:${row.playerId}` : `name:${row.player}`, { playerId: row.playerId, player: row.player });
  });

  return [...byKey.values()].map((playerRef) => ({
    ...playerRef,
    ...resolveTournamentContribution(competition, tournamentResult, playerRef, policyRegistry)
  }));
};

// Resolves EVERY tournament a competition references, for every known
// player in each, against a lookup of already-fetched TournamentResult
// objects keyed by tournamentId (the caller owns fetching/caching those —
// this module never reaches into Firebase/storage itself). Tournaments
// the competition references but that are missing from
// `resultsByTournamentId` are reported individually rather than failing
// the whole competition silently.
export const resolveCompetitionContributions = (competition, resultsByTournamentId, policyRegistry = {}) =>
  competition.tournamentIds.map((tournamentId) => {
    const result = resultsByTournamentId[tournamentId];
    if (!result) return { tournamentId, players: [], missing: true, reason: `no TournamentResult supplied for tournamentId "${tournamentId}"` };
    return { tournamentId, missing: false, players: resolveTournamentContributionsForAllPlayers(competition, result, policyRegistry) };
  });
