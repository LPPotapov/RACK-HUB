// Generic historical-import normalizers (RACK HUB PLATFORM — PHASE 2,
// section 4). These functions invent NOTHING — they only reshape
// already-real rows/matches a caller supplies into a valid
// TournamentResult. They are deliberately NOT specific to
// Vereinsmeisterschaft 2026 (no VM-only field names or assumptions), so
// any future historical import can reuse them.
//
// Deliberately does NOT read tests/fixtures/historical/ itself — this is
// src/, which must never depend on the tests/ directory (test fixtures
// are not guaranteed to exist in every build/deploy). Callers (tests, or
// a future import tool) load the real historical rows themselves and
// pass them in already-parsed.
//
// "No fictional matches are generated" (section 4/10): neither function
// below ever adds a `matches` field unless the caller explicitly supplies
// one — buildStandingsOnlyTournamentResult() never even accepts a
// `matches` parameter, so there is no code path by which a standings-only
// import could end up with an invented match history.

import { createParticipant, createStandingsRow, createTournamentResult } from '../domain/tournamentResult.js';

// `rows` — already-parsed final-table rows (whatever shape the historical
// source produced — e.g. tests/fixtures/historical/*/expected-final-table.json).
// Every row must at least carry `placement`, `player`, `matchPoints`;
// everything else (prestige, eventScore, racksWon, racksLost,
// rackDifferential, averagePerf, startingGbr, finalGbr, gbrChange,
// roundResults, games, ...) passes through verbatim via createStandingsRow().
export const buildStandingsOnlyTournamentResult = ({ tournamentId, name, date, discipline, rows }) =>
  createTournamentResult({
    tournamentId,
    name,
    date,
    discipline,
    participants: rows.map((row) => createParticipant({ name: row.player })),
    standings: rows.map((row) => createStandingsRow({ ...row })),
    source: { type: 'csv', completeness: 'standings' }
  });

// `rows` — the same final-table shape as above. `matches` — already-real
// match rows (e.g. matches.json), carried through completely unmodified;
// this module defines no canonical Match shape of its own (see
// tournamentResult.js's module header).
export const buildFullHistoryTournamentResult = ({ tournamentId, name, date, discipline, rows, matches }) =>
  createTournamentResult({
    tournamentId,
    name,
    date,
    discipline,
    participants: rows.map((row) => createParticipant({ name: row.player })),
    standings: rows.map((row) => createStandingsRow({ ...row })),
    matches,
    source: { type: 'csv', completeness: 'full' }
  });
