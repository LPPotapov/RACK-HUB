// Canaletto event shell (Canaletto MVP): a thin composition layer holding
// TWO independent canonical tournaments (Block A, Block B) plus event-level
// settings, lock state, and Top16 seeding/readiness.
//
// This module does NOT teach the generic BBS/tournament engine about
// "Block A"/"Block B" — each block is a completely ordinary canonical
// ApplicationState (src/domain/tournamentModel.js), operated on exclusively
// through the ALREADY-EXISTING, already-tested application commands in
// tournamentCommands.js (startTournament/recordMatchResult/
// advanceTournamentRound/assignMatchTable), UNCHANGED. No BBS/GBR/PERF/
// pairing formula is reimplemented or modified here.
//
// AUTHORITATIVE, INTENTIONALLY SEPARATE ORDERINGS (2nd director correction
// pass — do not blur these back together):
//   PAIRING ORDER (who plays whom in Round 2+):
//     MP desc -> PERF desc -> id fallback — i.e. the SAME
//     `compareFixedRackPairingOrder()` the generic advanceTournamentRound()/
//     legacy nextRound() already use. Canaletto does NOT override this
//     (a prior pass did; that override has been reverted — RackDiff must
//     never influence pairing). This is exactly why advanceBlockRound()
//     below can call the generic command directly with no wrapper.
//   RESULTS / QUALIFICATION ORDER (standings, round tables, All Rounds,
//   Block Results, Top-N highlighting, frozen qualifier order):
//     MP desc -> RackDiff desc -> PERF desc -> id fallback
//     (compareCanalettoOrder, below) — director-decided, visible/transparent
//     qualification criterion. This is the ONLY Canaletto-specific ordering
//     rule in this module.
//
// Every exported function is pure: CanalettoEvent in, new CanalettoEvent out
// (or a derived read-only value), no mutation of its input. Acting on one
// block only ever replaces that block's key on the returned event object —
// the other block's value is left as the exact same reference, so starting/
// scoring/advancing Block A structurally cannot affect Block B, and vice
// versa.
//
// CanalettoEvent shape (plain JSON-safe data, like ApplicationState):
//   {
//     schemaVersion,
//     settings: {
//       title, venue, date,
//       roundsPerBlock,       // -> each block's config.default_rounds
//       racksPerMatch,        // -> each block's config.max_games ("feste Racks")
//       round1SeedMethod,     // default Round 1 seeding for both blocks ('cross_elo')
//       qualificationThreshold // Top-N cut line, default 8
//     },
//     tables: [{ order, label, billardPadId, scoreLink }],  // shared event table list, see canalettoTables.js
//     blockA: ApplicationState,   // { tournament, preAdvanceSnapshot }
//     blockB: ApplicationState,
//     blockALock: null | { lockedAt, qualifiers: [Qualifier] },
//     blockBLock: null | { lockedAt, qualifiers: [Qualifier] },
//     top16: { started: boolean, startedAt: string | null }
//   }
//
// Qualifier (frozen at lock time, never recomputed afterward):
//   { seed: 'A1'..'A8'/'B1'..'B8', rank, playerId, name, mp, diff, perf, gbr }

import { reconstructStandingsBeforeRound } from '../domain/beforeRoundStandings.js';
import { compareFixedRackStandings } from '../domain/fixedRackBbs.js';
import {
  createApplicationState,
  createConfig,
  createTournamentState,
  validateApplicationState
} from '../domain/tournamentModel.js';
import {
  applyManualPairings as applyManualPairingsOp,
  markPlayerMissingThisRound as markPlayerMissingThisRoundOp,
  resetCurrentRound as resetCurrentRoundOp,
  undoPlayerMissingThisRound as undoPlayerMissingThisRoundOp
} from './canalettoRoundOps.js';
import {
  advanceTournamentRound as advanceTournamentRoundCommand,
  assignMatchTable as assignMatchTableCommand,
  recordMatchResult as recordMatchResultCommand,
  startTournament as startTournamentCommand
} from './tournamentCommands.js';

// RESULTS/QUALIFICATION order only (see header note above) — director
// decision: MP desc -> RackDiff desc -> PERF desc -> id fallback. This is
// EXACTLY the existing, already-tested `compareFixedRackStandings(a, b,
// 'racks')` comparator from fixedRackBbs.js — no new sort formula is
// written. It differs from the generic 'classic' ranking (MP -> PERF, no
// RackDiff) that the legacy app defaults to; Canaletto blocks opt into
// 'racks' explicitly via createBlockConfig() below for RESULTS purposes
// only — PAIRING (advanceBlockRound(), below) intentionally does NOT use
// this comparator, and nothing about the legacy fallback's own default
// ranking_system changes.
const CANALETTO_RANKING_SYSTEM = 'racks';
const compareCanalettoOrder = (a, b) => compareFixedRackStandings(a, b, CANALETTO_RANKING_SYSTEM);

export const CANALETTO_SCHEMA_VERSION = 1;

const assertBlock = (block) => {
  if (block !== 'A' && block !== 'B') {
    throw new Error(`Invalid Canaletto block "${block}" — must be "A" or "B"`);
  }
};

const blockKey = (block) => {
  assertBlock(block);
  return `block${block}`;
};

const lockKey = (block) => {
  assertBlock(block);
  return `block${block}Lock`;
};

const tableConfirmationsKey = (block) => {
  assertBlock(block);
  return `block${block}TableConfirmations`;
};

// ---------------------------------------------------------------------------
// Settings / event creation
// ---------------------------------------------------------------------------

export const createCanalettoSettings = (overrides = {}) => ({
  title: 'Canaletto Cup',
  venue: '',
  date: '',
  roundsPerBlock: 5,
  racksPerMatch: 8,
  round1SeedMethod: 'cross_elo',
  qualificationThreshold: 8,
  ...overrides
});

// Only the small set of Config fields Canaletto settings actually govern are
// derived from `settings` here — every other Config field (d/k_m/k_r/RP/...)
// keeps createConfig()'s existing BBS defaults, unchanged and unexposed.
const createBlockConfig = (settings) => createConfig({
  max_games: settings.racksPerMatch,
  default_rounds: settings.roundsPerBlock,
  format: 'fixed_rack',
  ranking_system: CANALETTO_RANKING_SYSTEM
});

const createEmptyBlock = (settings, label) => {
  const config = createBlockConfig(settings);
  return createApplicationState({
    tournament: createTournamentState({
      started: false,
      config,
      tournamentConfig: { title: label, ...config },
      roster: [],
      pendingPlayers: [],
      rounds: {},
      currentRound: 0,
      totalRounds: settings.roundsPerBlock
    })
  });
};

export const createCanalettoEvent = ({ settings: settingsOverrides, ...settingsShorthand } = {}) => {
  const settings = createCanalettoSettings({ ...settingsShorthand, ...settingsOverrides });
  return {
    schemaVersion: CANALETTO_SCHEMA_VERSION,
    settings,
    tables: [],
    blockA: createEmptyBlock(settings, `${settings.title} — Block A`),
    blockB: createEmptyBlock(settings, `${settings.title} — Block B`),
    blockALock: null,
    blockBLock: null,
    blockATableConfirmations: [],
    blockBTableConfirmations: [],
    top16: { started: false, startedAt: null }
  };
};

// ---------------------------------------------------------------------------
// Tables — a single, shared, ordered event table list (see
// src/application/canalettoTables.js for CSV/manual parsing). Configurable
// from Event Settings BEFORE either block starts, and freely re-editable
// afterward (this is operational floor-plan data, not a frozen-meaning
// setting like qualificationThreshold). Only `label` is ever handed to the
// canonical BBS layer (assignMatchTable()/generatePairings()'s
// `tableNumbers`) — billardPadId/scoreLink are inert metadata here, kept
// only for the future livescore task.
export const setEventTables = (event, tables) => ({ ...event, tables });

// Settings may only change while NEITHER block has started — once a block is
// running, its config is live/authoritative for that block's own
// recalculation, and silently rewriting it out from under a running block
// would be exactly the kind of change §2/§15 forbid.
export const canEditSettings = (event) => !event.blockA.tournament.started && !event.blockB.tournament.started;

export const updateCanalettoSettings = (event, overrides) => {
  if (!canEditSettings(event)) {
    throw new Error('updateCanalettoSettings: settings cannot change once a block has started');
  }
  const settings = { ...event.settings, ...overrides };
  const applyToBlock = (applicationState) => {
    const config = createBlockConfig(settings);
    return {
      ...applicationState,
      tournament: {
        ...applicationState.tournament,
        config,
        tournamentConfig: { ...applicationState.tournament.tournamentConfig, ...config },
        totalRounds: settings.roundsPerBlock
      }
    };
  };
  return {
    ...event,
    settings,
    blockA: applyToBlock(event.blockA),
    blockB: applyToBlock(event.blockB)
  };
};

// ---------------------------------------------------------------------------
// Pre-start player/roster management (Block A and Block B rosters are
// completely independent lists)
// ---------------------------------------------------------------------------

const assertBlockEditable = (event, block, action) => {
  if (event[lockKey(block)]) {
    throw new Error(`${action}: Block ${block} is locked and can no longer be changed`);
  }
  if (event[blockKey(block)].tournament.started) {
    throw new Error(`${action}: Block ${block} has already started`);
  }
};

export const setBlockRoster = (event, block, roster) => {
  assertBlockEditable(event, block, 'setBlockRoster');
  const key = blockKey(block);
  return {
    ...event,
    [key]: { ...event[key], tournament: { ...event[key].tournament, roster } }
  };
};

export const addPlayerToBlock = (event, block, player) => {
  assertBlockEditable(event, block, 'addPlayerToBlock');
  const key = blockKey(block);
  return setBlockRoster(event, block, [...event[key].tournament.roster, player]);
};

export const removePlayerFromBlock = (event, block, playerId) => {
  assertBlockEditable(event, block, 'removePlayerFromBlock');
  const key = blockKey(block);
  return setBlockRoster(event, block, event[key].tournament.roster.filter((p) => p.id !== playerId));
};

// Mid-tournament join (operator-control pass, items 20/21/23): while a block
// is RUNNING (and not locked), a late entrant joins via `pendingPlayers` —
// the SAME proven mechanism the generic advanceTournamentRound() command
// already promotes into the NEXT round with `joinedRound: next` (see
// tournamentCommands.js). This does NOT touch `roster` (the starting-GBR
// source for players present at Round 1) — a mid-tournament joiner's
// director-supplied GBR lives directly on their own pendingPlayers entry and
// is used as-is once promoted, matching existing, already-tested precedent
// (recalculateTournamentPlayers()'s roster-absent fallback to the player's
// own elo). The already-generated CURRENT round is never touched.
export const addPendingPlayerToBlock = (event, block, player) => {
  if (event[lockKey(block)]) {
    throw new Error(`addPendingPlayerToBlock: Block ${block} is locked and can no longer accept new players`);
  }
  const key = blockKey(block);
  if (!event[key].tournament.started) {
    throw new Error(`addPendingPlayerToBlock: Block ${block} has not started yet — use addPlayerToBlock instead`);
  }
  return {
    ...event,
    [key]: {
      ...event[key],
      tournament: { ...event[key].tournament, pendingPlayers: [...event[key].tournament.pendingPlayers, player] }
    }
  };
};

// ---------------------------------------------------------------------------
// Block lifecycle — thin wrappers over the existing canonical commands.
// Each only ever touches event[`block${block}`]; the sibling block's value
// is returned as the exact same object reference, never re-derived.
// ---------------------------------------------------------------------------

export const startBlock = (event, block, { seedMethod, manualSeeding, tableNumbers } = {}) => {
  if (event[lockKey(block)]) {
    throw new Error(`startBlock: Block ${block} is locked and can no longer be changed`);
  }
  const key = blockKey(block);
  const resolvedSeedMethod = seedMethod || event.settings.round1SeedMethod;
  const resolvedTableNumbers = tableNumbers || event.tables.map((t) => t.label);
  const nextBlock = startTournamentCommand(event[key], { seedMethod: resolvedSeedMethod, manualSeeding, tableNumbers: resolvedTableNumbers });
  return { ...event, [key]: nextBlock };
};

export const recordBlockMatchResult = (event, block, args) => {
  if (event[lockKey(block)]) {
    throw new Error(`recordBlockMatchResult: Block ${block} is locked; results are final`);
  }
  const key = blockKey(block);
  return { ...event, [key]: recordMatchResultCommand(event[key], args) };
};

// Round advancement (PAIRING) — reverted to calling the generic,
// legacy-fallback-shared advanceTournamentRound() command directly
// (MP -> PERF -> id pairing order, via compareFixedRackPairingOrder inside
// that command — see header note). A prior pass forked this into a
// Canaletto-specific wrapper that fed RackDiff-first order into pairing;
// manual testing showed that produced undesirable matchups, so that fork has
// been deleted entirely rather than kept dormant — there is now exactly ONE
// pairing implementation for both Canaletto and legacy.
export const advanceBlockRound = (event, block, { tableNumbers } = {}) => {
  if (event[lockKey(block)]) {
    throw new Error(`advanceBlockRound: Block ${block} is locked; no further rounds can be generated`);
  }
  const key = blockKey(block);
  const resolvedTableNumbers = tableNumbers || event.tables.map((t) => t.label);
  return { ...event, [key]: advanceTournamentRoundCommand(event[key], { tableNumbers: resolvedTableNumbers }) };
};

// Refuses once that match's round has been confirmed (see "Table
// confirmation" below) — a confirmed round's tables are FROZEN at both the
// UI and data layer; editBlockRoundTables() must un-confirm the round
// first. Locked-block guard unchanged.
export const assignBlockMatchTable = (event, block, args) => {
  if (event[lockKey(block)]) {
    throw new Error(`assignBlockMatchTable: Block ${block} is locked and can no longer be changed`);
  }
  if (isRoundTablesConfirmed(event, block, args.roundNumber)) {
    throw new Error(`assignBlockMatchTable: Round ${args.roundNumber}'s tables are confirmed and frozen — use editBlockRoundTables() to unfreeze them first`);
  }
  const key = blockKey(block);
  return { ...event, [key]: assignMatchTableCommand(event[key], args) };
};

// ---------------------------------------------------------------------------
// Table confirmation (per round) — table assignments a round is generated
// or edited with are DRAFT until the director explicitly confirms them;
// only confirmed rounds show their table assignments in All Rounds
// (isRoundTablesConfirmed() below gates that display — see
// MatchSummaryCard/BlockPage.jsx). Confirming a round FREEZES its tables:
// assignBlockMatchTable() (above) refuses to change any match's `tbl` in a
// confirmed round — both the UI dropdown AND this data-layer guard enforce
// it, so a confirmed round can't be edited by any path without going
// through editBlockRoundTables() first, which un-confirms it (and
// therefore hides it from All Rounds again) so it can be re-edited and
// must be explicitly re-confirmed before it reappears there. Tracked as a
// small ordered list of confirmed round numbers per block, not a field on
// Match/Tournament — this is Canaletto-only operational state, kept out of
// the canonical ApplicationState.
// ---------------------------------------------------------------------------

export const isRoundTablesConfirmed = (event, block, roundNumber) =>
  (event[tableConfirmationsKey(block)] || []).includes(roundNumber);

export const confirmBlockRoundTables = (event, block, roundNumber) => {
  if (event[lockKey(block)]) {
    throw new Error(`confirmBlockRoundTables: Block ${block} is locked and can no longer be changed`);
  }
  const key = tableConfirmationsKey(block);
  const list = event[key] || [];
  if (list.includes(roundNumber)) return event;
  return { ...event, [key]: [...list, roundNumber].sort((a, b) => a - b) };
};

// Unfreezes a previously-confirmed round's tables for editing — the round
// immediately disappears from All Rounds' table display again (since
// isRoundTablesConfirmed() now reads false for it) until
// confirmBlockRoundTables() is called again.
export const editBlockRoundTables = (event, block, roundNumber) => {
  if (event[lockKey(block)]) {
    throw new Error(`editBlockRoundTables: Block ${block} is locked and can no longer be changed`);
  }
  const key = tableConfirmationsKey(block);
  const list = event[key] || [];
  if (!list.includes(roundNumber)) return event;
  return { ...event, [key]: list.filter((r) => r !== roundNumber) };
};

// ---------------------------------------------------------------------------
// Current-round operator controls (operator-control pass) — thin, lock-
// guarded wrappers over the pure ApplicationState operations in
// canalettoRoundOps.js. Each is scoped to the CURRENT round only; earlier
// rounds are always left byte-for-byte unchanged (enforced by
// canalettoRoundOps.js itself, not re-checked here).
// ---------------------------------------------------------------------------

// Missing-this-round / bye conversion — round-local, NOT withdrawal (no
// `removed: true`, no roster change). See canalettoRoundOps.js for the exact
// authoritative bye numerics this reuses unchanged.
export const markBlockPlayerMissing = (event, block, args) => {
  if (event[lockKey(block)]) {
    throw new Error(`markBlockPlayerMissing: Block ${block} is locked and can no longer be changed`);
  }
  const key = blockKey(block);
  return { ...event, [key]: markPlayerMissingThisRoundOp(event[key], args) };
};

// Restores the exact original unplayed matchup — not a new pairing.
export const undoBlockPlayerMissing = (event, block, args) => {
  if (event[lockKey(block)]) {
    throw new Error(`undoBlockPlayerMissing: Block ${block} is locked and can no longer be changed`);
  }
  const key = blockKey(block);
  return { ...event, [key]: undoPlayerMissingThisRoundOp(event[key], args) };
};

// Explicit, director-requested re-pair of the CURRENT round only (never
// triggered automatically by a score correction). `seedMethod` defaults to
// the event's configured Round 1 seeding ONLY when resetting Round 1 itself
// (matching the seeding startBlock() would have used); every later round
// resets via the normal Swiss/cost-based pairing, exactly like a fresh
// advance.
export const resetBlockCurrentRound = (event, block, { tableNumbers } = {}) => {
  if (event[lockKey(block)]) {
    throw new Error(`resetBlockCurrentRound: Block ${block} is locked and can no longer be changed`);
  }
  const key = blockKey(block);
  const tournament = event[key].tournament;
  const resolvedTableNumbers = tableNumbers || event.tables.map((t) => t.label);
  const resolvedSeedMethod = tournament.currentRound === 1 ? event.settings.round1SeedMethod : null;
  const confirmationsKey = tableConfirmationsKey(block);
  return {
    ...event,
    [key]: resetCurrentRoundOp(event[key], { tableNumbers: resolvedTableNumbers, seedMethod: resolvedSeedMethod }),
    // The round's tables are regenerated from scratch — any prior
    // confirmation for this exact round number no longer describes what's
    // actually there, so it's cleared (the director confirms again once
    // satisfied with the rebuilt round).
    [confirmationsKey]: (event[confirmationsKey] || []).filter((r) => r !== tournament.currentRound)
  };
};

// Emergency manual re-pairing of the CURRENT round's still-open (uncompleted)
// matches only — completed matches are structurally protected (see
// canalettoRoundOps.js).
export const applyBlockManualPairings = (event, block, args) => {
  if (event[lockKey(block)]) {
    throw new Error(`applyBlockManualPairings: Block ${block} is locked and can no longer be changed`);
  }
  const key = blockKey(block);
  return { ...event, [key]: applyManualPairingsOp(event[key], args) };
};

// ---------------------------------------------------------------------------
// Standings / status
// ---------------------------------------------------------------------------

// Official current standings order for a block — always Canaletto's
// MP -> RackDiff -> PERF -> id order (compareCanalettoOrder, an existing,
// already-tested comparator, never a new ranking rule). Hardcoded here
// rather than read from tournament.config.ranking_system so every Canaletto
// screen (standings, round tables, All Rounds, Block Results, Top-N
// qualification, final locked qualifier order) provably sorts the same way.
// Adds a 1-based `rank`, plus `startingGbr`/`deltaGbr` (current GBR minus the
// block's own roster starting GBR — the same starting-GBR source the domain
// layer itself already uses for replay) for display only.
export const getBlockStandings = (event, block) => {
  const tournament = event[blockKey(block)].tournament;
  const startingGbrById = new Map(tournament.roster.map((p) => [p.id, p.elo]));
  const withStartingGbr = (p) => (startingGbrById.has(p.id) ? startingGbrById.get(p.id) : p.elo);
  return tournament.players
    .filter((p) => !p.removed)
    .slice()
    .sort(compareCanalettoOrder)
    .map((p, i) => {
      const startingGbr = withStartingGbr(p);
      return { ...p, rank: i + 1, startingGbr, deltaGbr: p.elo - startingGbr };
    });
};

// Standings AS OF strictly after a completed round — for the per-round
// standings tables in the All Rounds view (director correction pass). Small
// wrapper reuse, not a rewrite: delegates entirely to the existing, already-
// tested reconstructStandingsBeforeRound() (roundLimit = roundNumber + 1,
// i.e. "before the round after this one" = "through this round inclusive"),
// then applies the SAME Canaletto ordering as getBlockStandings(). Because
// this is derived fresh from stored round history on every call, a later
// correction to an earlier round's result is reflected automatically in
// every already-displayed round's standings snapshot — no stale frozen copy
// is ever stored, and no stored pairing is ever touched (RECALCULATION !=
// RE-PAIRING).
export const getRoundStandings = (event, block, roundNumber) => {
  const tournament = event[blockKey(block)].tournament;
  const startingGbrById = new Map(tournament.roster.map((p) => [p.id, p.elo]));
  const withStartingGbr = (p) => (startingGbrById.has(p.id) ? startingGbrById.get(p.id) : p.elo);
  const reconstructed = reconstructStandingsBeforeRound({
    players: tournament.players,
    startingRoster: tournament.roster,
    rounds: tournament.rounds,
    roundLimit: roundNumber + 1,
    config: tournament.config
  });
  return Object.values(reconstructed)
    .sort(compareCanalettoOrder)
    .map((p, i) => {
      const startingGbr = withStartingGbr(p);
      return { ...p, rank: i + 1, startingGbr, deltaGbr: p.elo - startingGbr };
    });
};

export const getBlockStatus = (event, block) => {
  if (event[lockKey(block)]) return 'LOCKED';
  if (event[blockKey(block)].tournament.started) return 'RUNNING';
  return 'NOT_STARTED';
};

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

export const canLockBlock = (event, block) => {
  if (event[lockKey(block)]) return { ok: false, reason: `Block ${block} is already locked` };
  const tournament = event[blockKey(block)].tournament;
  if (!tournament.started) return { ok: false, reason: `Block ${block} has not started` };
  if (tournament.currentRound < tournament.totalRounds) {
    return { ok: false, reason: `Block ${block} has not reached its final round (${tournament.currentRound}/${tournament.totalRounds})` };
  }
  const finalRoundMatches = tournament.rounds[tournament.currentRound] || [];
  if (finalRoundMatches.length === 0 || !finalRoundMatches.every((m) => m.done || m.cancelled)) {
    return { ok: false, reason: `Block ${block}'s final round is not yet fully completed` };
  }
  return { ok: true, reason: null };
};

// Freezes the Top qualificationThreshold players by CURRENT official
// standings into blockXLock.qualifiers and marks the block LOCKED. This is
// the ONLY place qualifiers are ever computed — once locked, they are never
// recomputed, and every other command above refuses to change a locked
// block's tournament state.
export const lockBlock = (event, block) => {
  const eligibility = canLockBlock(event, block);
  if (!eligibility.ok) {
    throw new Error(`lockBlock: cannot lock Block ${block}: ${eligibility.reason}`);
  }
  const threshold = event.settings.qualificationThreshold;
  const qualifiers = getBlockStandings(event, block)
    .slice(0, threshold)
    .map((p, i) => ({
      seed: `${block}${i + 1}`,
      rank: i + 1,
      playerId: p.id,
      name: p.name,
      mp: p.mp,
      diff: (p.racksWon || 0) - (p.racksLost || 0),
      perf: p.perfCount > 0 ? p.perf / p.perfCount : 0,
      gbr: p.elo,
      startingGbr: p.startingGbr,
      deltaGbr: p.deltaGbr
    }));
  return {
    ...event,
    [lockKey(block)]: { lockedAt: new Date().toISOString(), qualifiers }
  };
};

// Block Results display rows (director correction pass, item 6): the SAME
// rows getBlockStandings() already returns, with every row that is one of
// the block's FROZEN locked qualifiers additionally marked
// `lockedQualifier: true` — based strictly on blockXLock.qualifiers'
// identities (playerId), never a freshly recalculated dynamic Top-N. Before
// lock (no blockXLock yet), no row carries the flag at all — ordinary live
// qualification highlighting via `qualificationThreshold` remains a
// presentation concern for the UI to apply on top of this. After lock, a
// locked block rejects every mutating command (see above), so the frozen
// qualifier identities this returns can never silently drift.
export const getBlockResultsRows = (event, block) => {
  const lockData = event[lockKey(block)];
  const standings = getBlockStandings(event, block);
  if (!lockData) return standings;
  const lockedIds = new Set(lockData.qualifiers.map((q) => q.playerId));
  return lockData.qualifiers
    .map((q) => ({ ...q, lockedQualifier: true }))
    .concat(
      standings
        .filter((p) => !lockedIds.has(p.id))
        .map((p) => ({ ...p, playerId: p.id, lockedQualifier: false }))
    );
};

// ---------------------------------------------------------------------------
// Danger Zone — Unlock Block Results
// ---------------------------------------------------------------------------
//
// For "the director discovers a mistake after locking but before KO has
// actually started": preserves all rounds/results (tournament state is
// completely untouched), clears ONLY the lock wrapper + that block's frozen
// qualifiers, restoring score-correction/advancement eligibility. Guarded
// against Top16 already having started — there is no KO-reset operation yet
// (explicitly out of scope for this pass), so unlocking a block whose
// qualifiers may already be feeding a running bracket is refused rather than
// silently left inconsistent; once a real KO-reset exists, this guard is
// where it would be relaxed.
export const canUnlockBlock = (event, block) => {
  if (!event[lockKey(block)]) return { ok: false, reason: `Block ${block} is not locked` };
  if (event.top16.started) return { ok: false, reason: 'Top 16 has already started — cannot unlock a source block' };
  return { ok: true, reason: null };
};

export const unlockBlock = (event, block) => {
  const eligibility = canUnlockBlock(event, block);
  if (!eligibility.ok) {
    throw new Error(`unlockBlock: cannot unlock Block ${block}: ${eligibility.reason}`);
  }
  return { ...event, [lockKey(block)]: null };
};

// ---------------------------------------------------------------------------
// Danger Zone — Reset Block Tournament
// ---------------------------------------------------------------------------
//
// Resets ONE block back to its pre-start (CONFIGURED_PRE_START) state.
// PRESERVES: event settings, event table configuration (both untouched —
// this function never reads or writes `event.settings`/`event.tables`), and
// the block's ORIGINAL assigned roster (starting GBRs) — `tournament.roster`
// is carried over unchanged. RESETS: started, rounds, results, derived
// stats (players: []), pendingPlayers ([] — any not-yet-promoted
// mid-tournament joiner was never part of the original roster, so it is
// correctly discarded; an ALREADY-promoted mid-tournament joiner lives only
// inside the wiped `tournament.players`/is absent from `roster`, so it is
// also not carried into the reset roster — a deliberate simplification for
// this emergency tool, documented here rather than silently assumed), the
// block's lock + frozen qualifiers, and (since Top16 seeding may have
// sourced from this block) Top16's started state. Same Top16-started guard
// as unlockBlock() above, for the same reason.
export const canResetBlockTournament = (event, block) => {
  if (event.top16.started) return { ok: false, reason: 'Top 16 has already started — cannot reset a source block' };
  return { ok: true, reason: null };
};

export const resetBlockTournament = (event, block) => {
  const eligibility = canResetBlockTournament(event, block);
  if (!eligibility.ok) {
    throw new Error(`resetBlockTournament: cannot reset Block ${block}: ${eligibility.reason}`);
  }
  const key = blockKey(block);
  const currentTournament = event[key].tournament;
  const label = currentTournament.tournamentConfig.title;
  const config = createBlockConfig(event.settings);
  const resetTournament = createTournamentState({
    started: false,
    config,
    tournamentConfig: { title: label, ...config },
    roster: currentTournament.roster,
    pendingPlayers: [],
    rounds: {},
    currentRound: 0,
    totalRounds: event.settings.roundsPerBlock
  });
  return {
    ...event,
    [key]: createApplicationState({ tournament: resetTournament }),
    [lockKey(block)]: null,
    [tableConfirmationsKey(block)]: [],
    top16: { started: false, startedAt: null }
  };
};

// ---------------------------------------------------------------------------
// Top16
// ---------------------------------------------------------------------------

export const getTop16Status = (event) => {
  if (event.top16.started) return 'RUNNING';
  const aLocked = !!event.blockALock;
  const bLocked = !!event.blockBLock;
  if (aLocked && bLocked) return 'READY';
  if (aLocked) return 'WAITING_FOR_B';
  if (bLocked) return 'WAITING_FOR_A';
  return 'WAITING_FOR_BOTH';
};

// Exact, single, non-configurable Canaletto KO seeding: strictly from frozen
// block rank, never re-sorted by GBR/Swiss/cross_elo/anything else.
//   A1 vs B8   B1 vs A8
//   A2 vs B7   B2 vs A7
//   A3 vs B6   B3 vs A6
//   A4 vs B5   B4 vs A5
const TOP16_SEED_PAIRS = [[1, 8], [2, 7], [3, 6], [4, 5]];

export const computeTop16Seeding = (event) => {
  if (!event.blockALock || !event.blockBLock) {
    throw new Error('computeTop16Seeding: both Block A and Block B must be locked first');
  }
  const qa = event.blockALock.qualifiers;
  const qb = event.blockBLock.qualifiers;
  if (qa.length !== 8 || qb.length !== 8) {
    throw new Error('computeTop16Seeding: exact Top16 seeding requires exactly 8 frozen qualifiers from each block');
  }
  const pairings = [];
  TOP16_SEED_PAIRS.forEach(([hi, lo]) => {
    pairings.push({ matchNumber: pairings.length + 1, top: qa[hi - 1], bottom: qb[lo - 1] });
    pairings.push({ matchNumber: pairings.length + 1, top: qb[hi - 1], bottom: qa[lo - 1] });
  });
  return pairings;
};

// Placeholder slot for a not-yet-locked qualifier seed — deliberately NOT a
// real Qualifier shape (no playerId/gbr), so the UI can tell a real seed
// apart from an awaited one.
const placeholderQualifier = (block, seedNumber) => ({
  seed: `${block}${seedNumber}`,
  placeholder: true,
  name: `Awaiting Block ${block}`,
  playerId: null,
  gbr: null
});

// ALWAYS-VISIBLE Top16 seed preview (director correction pass): unlike
// computeTop16Seeding() above (strict — throws unless BOTH blocks are fully
// locked, used only to gate startTop16()), this always returns the 8 fixed
// seed slots, filling in whichever block(s) are already locked and using a
// placeholder for the other — so the director can see the bracket shape
// (and Block A's seeds as soon as Friday's Block A locks) before Block B
// even starts. The seed RELATIONSHIPS are identical and equally fixed
// (never re-sorted by GBR) — only the data behind each slot differs.
export const getTop16Seeding = (event) => {
  const qa = event.blockALock?.qualifiers;
  const qb = event.blockBLock?.qualifiers;
  const seedA = (n) => (qa && qa[n - 1]) || placeholderQualifier('A', n);
  const seedB = (n) => (qb && qb[n - 1]) || placeholderQualifier('B', n);
  const pairings = [];
  TOP16_SEED_PAIRS.forEach(([hi, lo]) => {
    pairings.push({ matchNumber: pairings.length + 1, top: seedA(hi), bottom: seedB(lo) });
    pairings.push({ matchNumber: pairings.length + 1, top: seedB(hi), bottom: seedA(lo) });
  });
  return pairings;
};

export const startTop16 = (event) => {
  if (event.top16.started) {
    throw new Error('startTop16: Top 16 has already started');
  }
  // Throws if not both locked / seeding isn't exactly 8v8 — validated before
  // any state change, matching every other command's atomicity here.
  computeTop16Seeding(event);
  return { ...event, top16: { started: true, startedAt: new Date().toISOString() } };
};

// Danger Zone — Reset Top16 (bug fix: previously there was no way back once
// Top16 was started — unlockBlock()/resetBlockTournament() both correctly
// refuse to touch a source block while top16.started is true, but nothing
// could ever clear that flag again, permanently locking the director out of
// both blocks' Danger Zone actions). Safe to reset unconditionally: full KO
// progression is not implemented yet, so "started" is currently only a flag
// with no bracket/match data behind it — resetting it loses nothing but the
// flag and its timestamp. Once real KO progression exists, this action (and
// the guards above) will need to account for in-progress bracket data; that
// is explicitly out of scope here.
export const canResetTop16 = (event) => {
  if (!event.top16.started) return { ok: false, reason: 'Top 16 has not started' };
  return { ok: true, reason: null };
};

export const resetTop16 = (event) => {
  const eligibility = canResetTop16(event);
  if (!eligibility.ok) {
    throw new Error(`resetTop16: cannot reset Top 16: ${eligibility.reason}`);
  }
  return { ...event, top16: { started: false, startedAt: null } };
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const validateCanalettoEvent = (event) => {
  const errors = [];
  if (typeof event !== 'object' || event === null || Array.isArray(event)) {
    return { valid: false, errors: ['CanalettoEvent must be a plain object'] };
  }
  if (!Array.isArray(event.tables)) errors.push('tables must be an array');
  // Not required: an event saved before table confirmation existed won't
  // have these fields yet, and every reader (isRoundTablesConfirmed(), etc.)
  // already tolerates their absence via `event[key] || []` — rejecting the
  // whole event here would wipe a director's already-saved tournament state
  // on reload, which is exactly the failure mode this check must avoid.
  if ('blockATableConfirmations' in event && !Array.isArray(event.blockATableConfirmations)) {
    errors.push('blockATableConfirmations must be an array when present');
  }
  if ('blockBTableConfirmations' in event && !Array.isArray(event.blockBTableConfirmations)) {
    errors.push('blockBTableConfirmations must be an array when present');
  }
  ['blockA', 'blockB'].forEach((key) => {
    const result = validateApplicationState(event[key]);
    if (!result.valid) errors.push(...result.errors.map((e) => `${key}.${e}`));
  });
  return { valid: errors.length === 0, errors };
};
