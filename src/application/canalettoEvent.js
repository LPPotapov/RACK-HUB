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
//     ko: { top16, quarterfinals, semifinals, final }  // each null | KoStage,
//                                                        // see canalettoKo.js
//     schedule: { blockA, blockB, top16Slot1, top16Slot2,
//                  quarterfinals, semifinals, final }    // each { start, end },
//                  // OPTIONAL planning-only estimates (director correction
//                  // pass) — plain local-datetime strings from an
//                  // <input type="datetime-local">, '' when unset. Never
//                  // read by any tournament-operation gate/command.
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
import {
  DEFAULT_KO_GBR_WEIGHT,
  KO_DEFAULT_TABLE_COUNT,
  KO_RACE_TO,
  KO_STAGE_ORDER,
  assignKoMatchTable as assignKoMatchTableOp,
  buildBracketProjection,
  buildKoPlayerSummary,
  buildKoResultsRows,
  buildNextStagePairings,
  confirmKoStageTables as confirmKoStageTablesOp,
  createKoStage,
  deriveKoRatingSimulation,
  editKoStageTables as editKoStageTablesOp,
  getKoChampion as getKoChampionOp,
  isKoStageComplete,
  recordKoMatchResult as recordKoMatchResultOp
} from './canalettoKo.js';

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

// Every KO stage starts unstarted (null). Present, not undefined, on every
// event so downstream readers never have to guess between "not built yet"
// and "not started yet" — see canalettoKo.js for the KoStage shape a
// non-null value holds.
const EMPTY_KO = { top16: null, quarterfinals: null, semifinals: null, final: null };

// Estimated schedule groups (director correction pass, item 5) — Top16 is
// split into its two operational timeslots here too, matching how it's
// actually played, even though it remains ONE KO stage/bracket round in
// `event.ko`.
export const SCHEDULE_KEYS = ['blockA', 'blockB', 'top16Slot1', 'top16Slot2', 'quarterfinals', 'semifinals', 'final'];

const EMPTY_SCHEDULE = Object.fromEntries(SCHEDULE_KEYS.map((key) => [key, { start: '', end: '' }]));

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
    ko: EMPTY_KO,
    schedule: EMPTY_SCHEDULE,
    koGbrWeight: DEFAULT_KO_GBR_WEIGHT
  };
};

// Single-KO GBR weight (docs task item 17-22) — an event-level setting,
// deliberately NOT gated by canEditSettings()/settings-lock: unlike
// settings, this never feeds Block A/B calculation at all (Block A/B never
// call canalettoKo.js), and by the time KO exists both blocks are already
// LOCKED (canEditSettings() would already read false), so gating this
// behind the same lock would make it uneditable in practice for its entire
// useful window — the director needs to be able to tune it while
// calibrating against real Top16 results, potentially between KO stages.
// `getKoGbrWeight()` resolves an absent/non-numeric value (older/restored
// state predating this field) to DEFAULT_KO_GBR_WEIGHT — never throws, never
// silently leaves the value undefined for a caller to mishandle.
export const getKoGbrWeight = (event) => (typeof event.koGbrWeight === 'number' && !Number.isNaN(event.koGbrWeight) ? event.koGbrWeight : DEFAULT_KO_GBR_WEIGHT);

export const updateKoGbrWeight = (event, weight) => {
  const n = Number(weight);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`updateKoGbrWeight: weight must be a number between 0 and 1 (got ${weight})`);
  }
  return { ...event, koGbrWeight: n };
};

// Estimated/planning-only — never gates or is read by any tournament-
// operation command (docs task item 5). `start`/`end` are optional; an
// omitted value is stored as '' rather than left undefined, so every
// schedule group always has the same shape.
export const updateCanalettoSchedule = (event, key, { start = '', end = '' } = {}) => {
  if (!SCHEDULE_KEYS.includes(key)) {
    throw new Error(`updateCanalettoSchedule: invalid schedule key "${key}"`);
  }
  return { ...event, schedule: { ...event.schedule, [key]: { start, end } } };
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
      // Rounded to a whole integer HERE (GBR_INTEGER_RULE — see
      // canalettoKo.js's header comment): this is the ONLY value that
      // actually feeds Top16 KO math (every later KO stage's PRE GBR
      // descends from this one), so it must already be integer at the
      // moment it's frozen — never a display-only rounding. The Block's
      // own live standings/pairing/ranking below (`getBlockStandings()`)
      // still use the player's full-precision `elo` completely unaffected;
      // only this frozen KO-facing snapshot is rounded.
      gbr: Math.round(p.elo),
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
  if (event.ko.top16) return { ok: false, reason: 'Top 16 has already started — cannot unlock a source block' };
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
  if (event.ko.top16) return { ok: false, reason: 'Top 16 has already started — cannot reset a source block' };
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
    ko: EMPTY_KO
  };
};

// ---------------------------------------------------------------------------
// Top16
// ---------------------------------------------------------------------------

export const getTop16Status = (event) => {
  if (event.ko.top16) return 'RUNNING';
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

// Full 4-stage bracket PROJECTION (director correction pass — "show the
// full tree at all times"): every one of the 15 bracket positions, with
// future/not-yet-generated stages filled by DERIVED preview slots (source
// labels or already-known participants) rather than by generating real
// QF/SF/Final match data early. Never creates or mutates any KO stage —
// purely a read. See buildBracketProjection() in canalettoKo.js for the
// full slot-resolution rules.
export const getBracketProjection = (event) => buildBracketProjection(event.ko, getTop16Seeding(event));

// ---------------------------------------------------------------------------
// KO progression — Top16 -> Quarterfinals -> Semifinals -> Final.
//
// A KO stage lives at `event.ko[stage]` (null until started; see
// canalettoKo.js for the KoStage/KoMatch shapes). Every stage-generation
// command is EXPLICIT (docs task item 13/33) — completing the last match of
// a stage never auto-creates the next one; the director calls
// startKoStage(event, nextStage) once ready.
// ---------------------------------------------------------------------------

const koStageIndex = (stage) => {
  const i = KO_STAGE_ORDER.indexOf(stage);
  if (i === -1) throw new Error(`Invalid KO stage "${stage}"`);
  return i;
};

export const canStartKoStage = (event, stage) => {
  const idx = koStageIndex(stage);
  if (event.ko[stage]) return { ok: false, reason: `${stage} has already started` };
  if (stage === 'top16') {
    const status = getTop16Status(event);
    if (status !== 'READY') return { ok: false, reason: 'Both Block A and Block B must be locked first' };
    return { ok: true, reason: null };
  }
  const previousStage = KO_STAGE_ORDER[idx - 1];
  if (!isKoStageComplete(event.ko[previousStage])) {
    return { ok: false, reason: `${previousStage} is not complete yet` };
  }
  return { ok: true, reason: null };
};

// Generates the ACTUAL matches for `stage` (docs task item 11 — not merely a
// boolean): Top16 pairings come from the frozen Block A/B seed slots
// (computeTop16Seeding — exact, never reseeded); every later stage's
// pairings come from buildNextStagePairings() on the PREVIOUS stage's own
// completed matches, in stored bracket order, carrying the winner's updated
// GBR forward as that match's frozen pre-match snapshot (see canalettoKo.js).
// Tables default to the first `KO_DEFAULT_TABLE_COUNT[stage]` configured
// event tables, in their existing order (docs task item 21) — never
// hardcoded by label.
export const startKoStage = (event, stage) => {
  const eligibility = canStartKoStage(event, stage);
  if (!eligibility.ok) {
    throw new Error(`startKoStage: cannot start ${stage}: ${eligibility.reason}`);
  }
  const idx = koStageIndex(stage);
  const pairings = stage === 'top16'
    ? computeTop16Seeding(event)
    : buildNextStagePairings(event.ko[KO_STAGE_ORDER[idx - 1]]);
  const tableLabels = event.tables.map((t) => t.label).slice(0, KO_DEFAULT_TABLE_COUNT[stage]);
  return { ...event, ko: { ...event.ko, [stage]: createKoStage(pairings, tableLabels) } };
};

// Backward-compatible, Top16-specific entry point over the generic
// startKoStage() above.
export const startTop16 = (event) => startKoStage(event, 'top16');

// A stage's results stay correctable (docs task item 16) until the NEXT
// stage has actually started — at that point winner propagation into the
// next stage's frozen match snapshots is already committed, so a correction
// here could no longer be reflected there without silently rewriting an
// already-started later stage.
export const canCorrectKoStage = (event, stage) => {
  const idx = koStageIndex(stage);
  const next = KO_STAGE_ORDER[idx + 1];
  return !(next && event.ko[next]);
};

export const recordKoResult = (event, stage, { matchNumber, r1, r2 }) => {
  if (!event.ko[stage]) throw new Error(`recordKoResult: ${stage} has not started`);
  if (!canCorrectKoStage(event, stage)) {
    throw new Error(`recordKoResult: ${stage} is locked — the next stage has already started`);
  }
  const target = KO_RACE_TO[stage];
  // Shared d/k_m/k_r — Block A and Block B always agree on these (Canaletto
  // settings only ever override max_games/default_rounds/format/
  // ranking_system, never the GBR constants themselves; see
  // createBlockConfig()), so either source is equivalent. No new constants.
  const gbrConfig = event.blockA.tournament.config;
  const updatedStage = recordKoMatchResultOp(event.ko[stage], { matchNumber, r1, r2 }, target, gbrConfig, getKoGbrWeight(event));
  return { ...event, ko: { ...event.ko, [stage]: updatedStage } };
};

export const assignKoTable = (event, stage, { matchNumber, table }) => {
  if (!event.ko[stage]) throw new Error(`assignKoTable: ${stage} has not started`);
  if (!canCorrectKoStage(event, stage)) {
    throw new Error(`assignKoTable: ${stage} is locked — the next stage has already started`);
  }
  if (event.ko[stage].tablesConfirmed) {
    throw new Error(`assignKoTable: ${stage}'s tables are confirmed and frozen — use editKoTables() to unfreeze them first`);
  }
  return { ...event, ko: { ...event.ko, [stage]: assignKoMatchTableOp(event.ko[stage], matchNumber, table) } };
};

export const confirmKoTables = (event, stage) => {
  if (!event.ko[stage]) throw new Error(`confirmKoTables: ${stage} has not started`);
  return { ...event, ko: { ...event.ko, [stage]: confirmKoStageTablesOp(event.ko[stage]) } };
};

export const editKoTables = (event, stage) => {
  if (!event.ko[stage]) throw new Error(`editKoTables: ${stage} has not started`);
  return { ...event, ko: { ...event.ko, [stage]: editKoStageTablesOp(event.ko[stage]) } };
};

// Champion is DERIVED from the Final stage's own match data, never stored
// separately — so a still-legal correction to the Final (docs task item 27)
// can never leave a stale champion record behind.
export const getKoChampion = (event) => getKoChampionOp(event.ko.final);

// KO Results/calibration table rows (docs task item 11) — DERIVED fresh from
// `event.ko` on every call, never a separately stored/duplicated table (item
// 22). `gbrConfig` is Block A's config, the same shared d/k_m/k_r source
// recordKoResult() itself uses — see that command's own comment.
export const getKoResultsRows = (event) => buildKoResultsRows(event.ko, event.blockA.tournament.config);

// KO Player Summary (docs task item 29) — DERIVED fresh from `event.ko`,
// never stored.
export const getKoPlayerSummary = (event) => buildKoPlayerSummary(event.ko, event.blockA.tournament.config);

// KO rating CALIBRATION PREVIEW (director bugfix pass, items 11-22): a pure,
// read-only sequential replay of the whole bracket at an arbitrary
// `multiplier`, independent of whatever each match's OWN stored
// rawDelta/appliedDelta/postGbr actually is — see deriveKoRatingSimulation()
// in canalettoKo.js for why this is not simply "multiply the stored
// deltas". Never mutates `event`; the caller (Top16Page.jsx) drives this
// with local-only UI state, never `run()`/store commits, so typing in the
// preview field can never rewrite stored scores/bracket/settings.
export const getKoRatingSimulation = (event, multiplier) => deriveKoRatingSimulation(event.ko, event.blockA.tournament.config, multiplier);

// Champion's own row from the player summary, merged with getKoChampion()'s
// identity/final-score fields (docs task item 30) — the single most
// important calibration number: how much APPLIED KO GBR the eventual
// champion accumulated across their whole four-match run. `null` until the
// Final is complete (matches getKoChampion()'s own null-until-complete
// contract).
export const getKoChampionSummary = (event) => {
  const champion = getKoChampion(event);
  if (!champion) return null;
  const summary = getKoPlayerSummary(event).find((p) => p.playerId === champion.playerId);
  return { ...champion, startGbr: summary.startGbr, currentGbr: summary.currentGbr, totalDeltaGbr: summary.totalDeltaGbr };
};

// The furthest-advanced KO stage that has actually started — the one
// "RESET CURRENT KO STAGE" (below) walks back exactly one step from.
export const getCurrentKoStage = (event) => {
  for (let i = KO_STAGE_ORDER.length - 1; i >= 0; i--) {
    if (event.ko[KO_STAGE_ORDER[i]]) return KO_STAGE_ORDER[i];
  }
  return null;
};

// ---------------------------------------------------------------------------
// Danger Zone — Reset Current KO Stage (docs task item 17/19: ONE
// understandable recovery model, replacing the old boolean-only
// resetTop16()/canResetTop16() pair now that real KO stages/matches exist).
// Deletes ONLY the furthest-advanced started stage's matches, reopening the
// stage before it for correction:
//   current = final          -> delete Final, reopen completed Semifinals
//   current = semifinals     -> delete Semifinals, reopen completed Quarterfinals
//   current = quarterfinals  -> delete Quarterfinals, reopen completed Top16
//   current = top16          -> delete Top16 (back to pre-start; re-enables
//                                 Block A/B Unlock/Reset again, matching the
//                                 old resetTop16() bug-fix behavior exactly)
// NEVER touches blockALock/blockBLock/qualifiers or either block's
// tournament state — only ever replaces one key under `event.ko`.
// ---------------------------------------------------------------------------

export const canResetKoStage = (event) => {
  const stage = getCurrentKoStage(event);
  if (!stage) return { ok: false, reason: 'No KO stage has started' };
  return { ok: true, reason: null };
};

export const resetKoStage = (event) => {
  const eligibility = canResetKoStage(event);
  if (!eligibility.ok) {
    throw new Error(`resetKoStage: cannot reset current KO stage: ${eligibility.reason}`);
  }
  const stage = getCurrentKoStage(event);
  return { ...event, ko: { ...event.ko, [stage]: null } };
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
  // Optional, like the table-confirmation lists above: an event saved before
  // the KO engine existed won't have this field yet.
  if ('ko' in event && event.ko !== null) {
    if (typeof event.ko !== 'object' || Array.isArray(event.ko)) {
      errors.push('ko must be a plain object when present');
    } else {
      KO_STAGE_ORDER.forEach((stage) => {
        const stageState = event.ko[stage];
        if (stageState === undefined || stageState === null) return;
        if (typeof stageState !== 'object' || !Array.isArray(stageState.matches)) {
          errors.push(`ko.${stage} must be null or a KoStage object with a matches array`);
        }
      });
    }
  }
  // Optional, like `ko` above: an event saved before schedule estimates
  // existed won't have this field yet.
  if ('schedule' in event && event.schedule !== null) {
    if (typeof event.schedule !== 'object' || Array.isArray(event.schedule)) {
      errors.push('schedule must be a plain object when present');
    } else {
      SCHEDULE_KEYS.forEach((key) => {
        const entry = event.schedule[key];
        if (entry === undefined) return;
        if (typeof entry !== 'object' || entry === null || typeof entry.start !== 'string' || typeof entry.end !== 'string') {
          errors.push(`schedule.${key} must be an object with string start/end when present`);
        }
      });
    }
  }
  ['blockA', 'blockB'].forEach((key) => {
    const result = validateApplicationState(event[key]);
    if (!result.valid) errors.push(...result.errors.map((e) => `${key}.${e}`));
  });
  return { valid: errors.length === 0, errors };
};
