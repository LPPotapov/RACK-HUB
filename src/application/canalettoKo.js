// Canaletto Top16 -> Quarterfinals -> Semifinals -> Final knockout engine.
//
// Pure, Canaletto-KO-specific application module — parallel to
// canalettoRoundOps.js, NOT a modification of the generic fixed-rack
// commands in tournamentCommands.js. Race-to-N knockout matches are
// semantically different from fixed-rack tournament matches (no fixed total
// racks, must have a winner, no draw), so this module does not call
// recordMatchResult()/the fixed-rack Match model at all — it defines its own
// small KoMatch/KoStage shapes and its own race-to validation.
//
// KoMatch shape (plain JSON-safe data):
//   {
//     matchNumber,        // 1-based position within this stage (bracket order preserved)
//     p1, p2: { seed, playerId, name, gbr },  // FROZEN pre-match snapshot — seed identity
//                          // carries forward from the qualifier that originally earned it;
//                          // gbr is the rating this player entered THIS match with
//     tbl,                 // table label (string) or null — same convention as canalettoTables.js
//     r1, r2,                // race-to score, or null until entered
//     done,                   // boolean
//     winnerPlayerId,          // set once done
//     rawDelta,                 // p1's UNWEIGHTED GBR change from the raw BBS formula (see
//                                 // GBR METHODOLOGY below); p2's raw change is exactly -rawDelta.
//                                 // null until done.
//     appliedDelta,               // p1's WEIGHTED change actually applied to KO progression
//                                  // (rawDelta * koGbrWeight — see KO GBR WEIGHTING below); p2's
//                                  // applied change is exactly -appliedDelta. null until done.
//     p1PostGbr, p2PostGbr          // p1.gbr + appliedDelta / p2.gbr - appliedDelta — the ACTUAL
//                                    // GBR each player carries into their next KO match (see
//                                    // winnerSlot() below). null until done.
//   }
//
// KoStage shape:
//   { startedAt, matches: [KoMatch], tablesConfirmed }
//
// GBR METHODOLOGY — RAW calculation (documented mapping, unchanged from the
// prior pass): recordKoMatchResult() below feeds a race-to result's ACTUAL
// played rack counts (r1, r2 — e.g. 7 and 4 for a race-to-7 match completed
// 7-4) directly into the EXISTING, UNMODIFIED
// `fixedRackBbs.gbrChange(gbrA, gbrB, racksA, racksB, {d, k_m, k_r})` as
// racksA/racksB, using the SAME d/k_m/k_r constants already governing the
// source Blocks (no new K values, no new denominator, no change to
// expectedScore()/the rack-ratio formula/fixedRackBbs.js itself). This
// produces `rawDelta` — see tests/canaletto-ko-gbr-characterization.test.js
// for representative race-to-7/race-to-9 characterization results.
//
// GBR METHODOLOGY — KO GBR WEIGHTING (director-authorized methodology
// decision, this pass): a full raw BBS change applied to every KO match is
// too aggressive once stacked across a guaranteed four-match winning streak
// (Top16 -> QF -> SF -> Final) for the eventual champion. A Canaletto
// Single-KO GBR weight (`koGbrWeight`, event-level setting, default 0.50)
// is applied AFTER the unmodified raw calculation above, purely at this
// application layer:
//   appliedDelta = rawDelta * koGbrWeight
// Player B's applied change is exactly `-appliedDelta` (zero-sum is
// preserved by construction, not re-derived). This is the ONLY new
// methodology in this module — it does not touch k_m/k_r/d/expectedScore()/
// the rack-ratio formula/race-score interpretation, and it applies ONLY to
// the Single KO phase (Block A/B never call this module at all). No hard
// delta cap is applied — see recordKoMatchResult() below.
//
// GBR_INTEGER_RULE (director correction, this pass): GBR and delta-GBR are
// whole integers EVERYWHERE visible in Canaletto, and this is not merely
// display rounding but an AUTHORITATIVE STORAGE rule for KO progression:
// `appliedDelta` (and therefore `p1PostGbr`/`p2PostGbr`) are real stored
// integers, not floats rounded only for display. The exact procedure
// (never deviate from this order):
//   1. rawDelta = gbrChange(...)                    -- FULL float precision
//   2. weightedDelta = rawDelta * koGbrWeight        -- FULL float precision
//   3. appliedDelta = Math.round(weightedDelta)      -- ONE rounding, ever
//   4. postA = preA + appliedDelta; postB = preB - appliedDelta
// Player B's applied delta/post GBR are NEVER independently computed or
// rounded -- they are exact negations/complements of Player A's
// already-rounded integer, which is what makes
// appliedDeltaA + appliedDeltaB === 0 hold EXACTLY (not within floating
// tolerance) for every KO match. `rawDelta` itself is deliberately NEVER
// rounded internally -- only its rounded-and-weighted derivative
// (`appliedDelta`) is; the weighting calculation always uses the
// full-precision raw value, never a value already rounded for display.
//
// This rule only closes correctly if `p1.gbr`/`p2.gbr` -- the PRE GBR each
// match starts from -- are ALSO always integers. For Top16 that means the
// frozen Block qualifier snapshot itself must be an integer at the moment
// it's frozen (see `lockBlock()` in canalettoEvent.js, which now rounds
// `qualifier.gbr` -- the ONLY value that actually feeds KO math; it does
// NOT touch a Block's own live, full-precision GBR/standings/pairing,
// which remain completely unaffected). For QF/SF/Final, PRE GBR is always
// the previous stage's already-integer POST GBR (via winnerSlot()), so the
// chain holds automatically from there on.

import { expectedScore, gbrChange } from '../domain/fixedRackBbs.js';

export const DEFAULT_KO_GBR_WEIGHT = 0.5;

export const KO_STAGE_ORDER = ['top16', 'quarterfinals', 'semifinals', 'final'];

export const KO_RACE_TO = { top16: 7, quarterfinals: 7, semifinals: 7, final: 9 };

// Director correction pass: Top16 is ONE bracket round (8 matches, seed
// relationships/propagation unchanged) but is operationally played in TWO
// four-match timeslots on only the four preferred tables — Slot 1 (matches
// 1-4) then Slot 2 (matches 5-8), reusing the SAME four tables. This is a
// pure display/table-assignment grouping, not a second seeding step and not
// a second bracket round (see KO_DEFAULT_TABLE_COUNT/createKoStageMatches
// below for how the table reuse is derived, and top16SlotForMatch() for the
// grouping itself).
export const KO_TOP16_SLOT_SIZE = 4;

export const top16SlotForMatch = (matchNumber) => (matchNumber <= KO_TOP16_SLOT_SIZE ? 1 : 2);

export const KO_DEFAULT_TABLE_COUNT = { top16: 4, quarterfinals: 4, semifinals: 2, final: 1 };

export const KO_STAGE_LABEL = {
  top16: 'Top 16',
  quarterfinals: 'Quarterfinals',
  semifinals: 'Semifinals',
  final: 'Final'
};

// Stage label used in the KO Results/calibration table (docs task item 16):
// Top16 rows distinguish their operational slot; every other stage uses its
// normal label. Purely a display derivation — matchNumber alone determines
// the slot, no separate slot field is stored on the match.
export const koResultsStageLabel = (stage, matchNumber) => {
  if (stage === 'top16') return `TOP16 SLOT ${top16SlotForMatch(matchNumber)}`;
  return KO_STAGE_LABEL[stage].toUpperCase();
};

// A KO match must have a winner: exactly one side reaches `target`, the
// other is a non-negative integer strictly below it. No draw, no
// fixed-rack-style blank-side autocomplete (see docs task item 15) — both
// values are always required and validated together.
export const isValidKoScore = (r1, r2, target) => {
  if (!Number.isInteger(r1) || !Number.isInteger(r2)) return false;
  if (r1 < 0 || r2 < 0) return false;
  if (r1 > target || r2 > target) return false;
  const p1Reached = r1 === target;
  const p2Reached = r2 === target;
  return p1Reached !== p2Reached;
};

const toSlot = (source) => ({
  seed: source.seed,
  playerId: source.playerId,
  name: source.name,
  gbr: source.gbr
});

// `pairings`: [{ matchNumber, top, bottom }], top/bottom already
// { seed, playerId, name, gbr } (a frozen Qualifier or a winnerSlot() below).
// `tableLabels`: configured table labels in preferred order (docs task item
// 21). Indexed with wraparound (`i % tableLabels.length`) rather than a
// plain `tableLabels[i]` lookup — for every stage except Top16 this behaves
// identically to direct indexing (pairings.length === tableLabels.length
// there), but for Top16 it is what makes Slot 2 (matches 5-8) reuse the same
// four preferred tables as Slot 1 (matches 1-4), since the caller passes
// only 4 table labels for 8 matches (see KO_DEFAULT_TABLE_COUNT.top16).
export const createKoStageMatches = (pairings, tableLabels = []) =>
  pairings.map((pairing, i) => ({
    matchNumber: pairing.matchNumber,
    p1: toSlot(pairing.top),
    p2: toSlot(pairing.bottom),
    tbl: tableLabels.length > 0 ? (tableLabels[i % tableLabels.length] ?? null) : null,
    r1: null,
    r2: null,
    done: false,
    winnerPlayerId: null,
    rawDelta: null,
    appliedDelta: null,
    p1PostGbr: null,
    p2PostGbr: null
  }));

export const createKoStage = (pairings, tableLabels = []) => ({
  startedAt: new Date().toISOString(),
  matches: createKoStageMatches(pairings, tableLabels),
  tablesConfirmed: false
});

export const isKoStageComplete = (stage) =>
  !!stage && stage.matches.length > 0 && stage.matches.every((m) => m.done);

// Records (or corrects — same path, matching recordMatchResult()'s own
// precedent) one match's race-to result. Immutable: returns a new stage,
// touching only the one match. `gbrConfig` is `{ d, k_m, k_r }`, read by the
// caller from an existing block's tournament.config — no new constants are
// introduced here. `koGbrWeight` (0..1, default DEFAULT_KO_GBR_WEIGHT) is
// the Single-KO GBR weight (see GBR METHODOLOGY above) — REQUIRED, not
// defaulted inside this pure function, matching this codebase's existing
// precedent of never silently assuming a caller's methodology choice (e.g.
// `started`/`seedMethod`); the event-layer caller (canalettoEvent.js's
// recordKoResult()) is the one place that resolves an unset/legacy weight
// to DEFAULT_KO_GBR_WEIGHT.
export const recordKoMatchResult = (stage, { matchNumber, r1, r2 }, target, gbrConfig, koGbrWeight) => {
  if (!stage) throw new Error('recordKoMatchResult: this stage has not started');
  if (!isValidKoScore(r1, r2, target)) {
    throw new Error(`recordKoMatchResult: invalid race-to-${target} score ${r1}-${r2}`);
  }
  if (typeof koGbrWeight !== 'number' || Number.isNaN(koGbrWeight)) {
    throw new Error('recordKoMatchResult: koGbrWeight must be an explicit number');
  }
  const match = stage.matches.find((m) => m.matchNumber === matchNumber);
  if (!match) throw new Error(`recordKoMatchResult: match ${matchNumber} does not exist in this stage`);
  if (match.p1.playerId == null || match.p2.playerId == null) {
    throw new Error('recordKoMatchResult: match is not fully seeded yet');
  }

  // RAW: the exact existing, unmodified BBS formula — no scaling, no cap.
  // Kept at full internal precision (never rounded) — GBR_INTEGER_RULE
  // below applies only to the APPLIED delta and POST GBR.
  const rawDelta = gbrChange(match.p1.gbr, match.p2.gbr, r1, r2, gbrConfig);
  // APPLIED: the RAW change weighted by the Single-KO GBR weight, then
  // rounded ONCE to the nearest integer (GBR_INTEGER_RULE — see header
  // comment) — this, not rawDelta, is what actually moves a player's GBR
  // forward into their next KO match (see winnerSlot() below). Player B's
  // applied change is the EXACT negative of this already-rounded integer,
  // never independently rounded — this is what guarantees
  // appliedDeltaA + appliedDeltaB === 0 exactly, not merely within floating
  // tolerance.
  const appliedDelta = Math.round(rawDelta * koGbrWeight);
  const winnerPlayerId = r1 > r2 ? match.p1.playerId : match.p2.playerId;

  const updatedMatch = {
    ...match,
    r1,
    r2,
    done: true,
    winnerPlayerId,
    rawDelta,
    appliedDelta,
    p1PostGbr: match.p1.gbr + appliedDelta,
    p2PostGbr: match.p2.gbr - appliedDelta
  };

  return { ...stage, matches: stage.matches.map((m) => (m.matchNumber === matchNumber ? updatedMatch : m)) };
};

export const assignKoMatchTable = (stage, matchNumber, table) => {
  if (!stage) throw new Error('assignKoMatchTable: this stage has not started');
  const match = stage.matches.find((m) => m.matchNumber === matchNumber);
  if (!match) throw new Error(`assignKoMatchTable: match ${matchNumber} does not exist in this stage`);
  return { ...stage, matches: stage.matches.map((m) => (m.matchNumber === matchNumber ? { ...m, tbl: table } : m)) };
};

export const confirmKoStageTables = (stage) => {
  if (!stage) throw new Error('confirmKoStageTables: this stage has not started');
  return { ...stage, tablesConfirmed: true };
};

export const editKoStageTables = (stage) => {
  if (!stage) throw new Error('editKoStageTables: this stage has not started');
  return { ...stage, tablesConfirmed: false };
};

// The winning player's identity/seed carried forward, WITH their UPDATED
// post-match GBR (docs task item 10) — this becomes the rating the next
// generated stage snapshots as that match's pre-match GBR. The match this
// slot was produced from is never mutated, so its own frozen display is
// unaffected by what a later stage does with the winner's rating.
const winnerSlot = (match) => {
  const isP1Winner = match.winnerPlayerId === match.p1.playerId;
  const winner = isP1Winner ? match.p1 : match.p2;
  const postGbr = isP1Winner ? match.p1PostGbr : match.p2PostGbr;
  return { seed: winner.seed, playerId: winner.playerId, name: winner.name, gbr: postGbr };
};

// Fixed bracket propagation, NO reseeding (docs task item 6/23): consecutive
// match pairs from the completed stage feed the next stage in stored
// bracket order — match 1 & 2 -> next match 1, match 3 & 4 -> next match 2,
// etc. Requires every match in `stage` to be done.
export const buildNextStagePairings = (stage) => {
  if (!isKoStageComplete(stage)) {
    throw new Error('buildNextStagePairings: every match in this stage must be complete first');
  }
  const pairs = [];
  for (let i = 0; i < stage.matches.length; i += 2) {
    const top = stage.matches[i];
    const bottom = stage.matches[i + 1];
    pairs.push({ matchNumber: pairs.length + 1, top: winnerSlot(top), bottom: winnerSlot(bottom) });
  }
  return pairs;
};

// ---------------------------------------------------------------------------
// KO Results / GBR calibration table (director correction pass items 11-16,
// redesigned for A/B symmetry in this pass — item 13/14). DERIVED on every
// call from authoritative `ko` match state — no duplicate rows are ever
// stored (docs task item 22). One row per generated match across every
// stage, in stage/bracket order. `gbrConfig` is the same `{d,k_m,k_r}`
// object recordKoResult() itself already uses — expected-% here is
// calculated the identical way koFrozenMatchDisplay() does for the
// operational cards (same expectedScore() call, same frozen p1.gbr/p2.gbr
// inputs), not a second formula.
//
// `playerA`/`playerB` deliberately expose the EXACT SAME fields in the EXACT
// SAME order (seed/name/preGbr/expectedPct/score/rawDelta/appliedDelta/
// postGbr) so a symmetric UI (or a director scanning by eye) can compare
// them directly — this is the "symmetry" requirement, not a stylistic
// choice. rawDelta/appliedDelta/postGbr are `null` until the match is done
// — never a fabricated placeholder value. playerB's rawDelta/appliedDelta
// are exactly the negation of playerA's (zero-sum), read directly off the
// single `m.rawDelta`/`m.appliedDelta` stored on the match — never a second
// computation that could drift from it.
// ---------------------------------------------------------------------------
const winnerIdentity = (m) => {
  const winnerIsP1 = m.done && m.winnerPlayerId === m.p1.playerId;
  const winnerIsP2 = m.done && m.winnerPlayerId === m.p2.playerId;
  return {
    winnerSeed: winnerIsP1 ? m.p1.seed : winnerIsP2 ? m.p2.seed : null,
    winnerName: winnerIsP1 ? m.p1.name : winnerIsP2 ? m.p2.name : null
  };
};

const side = (slot, opponentGbr, score, rawDelta, appliedDelta, postGbr, done, gbrConfig) => ({
  playerId: slot.playerId,
  seed: slot.seed,
  name: slot.name,
  preGbr: slot.gbr,
  expectedPct: expectedScore(slot.gbr, opponentGbr, gbrConfig.d) * 100,
  score,
  rawDelta: done ? rawDelta : null,
  appliedDelta: done ? appliedDelta : null,
  postGbr: done ? postGbr : null
});

export const buildKoResultsRows = (ko, gbrConfig) => {
  const rows = [];
  KO_STAGE_ORDER.forEach((stage) => {
    const stageState = ko[stage];
    if (!stageState) return;
    stageState.matches.forEach((m) => {
      rows.push({
        stage,
        stageLabel: koResultsStageLabel(stage, m.matchNumber),
        matchNumber: m.matchNumber,
        tbl: m.tbl,
        target: KO_RACE_TO[stage],
        done: m.done,
        winnerPlayerId: m.winnerPlayerId,
        ...winnerIdentity(m),
        playerA: side(m.p1, m.p2.gbr, m.r1, m.rawDelta, m.appliedDelta, m.p1PostGbr, m.done, gbrConfig),
        playerB: side(m.p2, m.p1.gbr, m.r2, m.rawDelta == null ? null : -m.rawDelta, m.appliedDelta == null ? null : -m.appliedDelta, m.p2PostGbr, m.done, gbrConfig)
      });
    });
  });
  return rows;
};

// ---------------------------------------------------------------------------
// KO Rating Simulation — sequential replay (director bugfix pass, items
// 2/13/14). `buildKoResultsRows()` above trusts each match's OWN stored
// `rawDelta`/`appliedDelta`/`p1PostGbr`/`p2PostGbr` — correct for matches
// recorded by the CURRENT recordKoMatchResult(), but a match recorded
// before a given `koGbrWeight` existed/changed keeps whatever it was
// actually computed with at THAT time (completed KO results are immutable
// historical facts, exactly like every other completed-match record in this
// codebase — never silently rewritten by a later methodology change).
//
// deriveKoRatingSimulation() is a SEPARATE, PURE calculation: given the
// bracket's player identities/table/race (from `ko`) and each match's
// STORED SCORE (r1/r2 — always trustworthy, independent of any GBR
// methodology), it REPLAYS the entire KO history from scratch stage-by-
// stage using ONLY `multiplier`, calling the exact same low-level
// gbrChange()/expectedScore() this module always uses. It never reads a
// match's own rawDelta/appliedDelta/postGbr fields — only p1/p2 identity,
// r1/r2, and (for Top16 only) the frozen starting GBR snapshot, which is
// ALWAYS trustworthy regardless of weighting history (Top16's pre-match GBR
// comes straight from the frozen Block qualifiers, never from a KO
// calculation). This is what makes the simulation correct even for a
// pre-existing bracket that has stale/pre-weighting-era completed matches —
// and it is exactly what makes changing `multiplier` correctly cascade into
// every later stage's PRE GBR/expected%/RAW delta, not just its own
// APPLIED delta (docs task item 13: "do not just multiply displayed
// deltas"). Never mutates `ko` or writes anything back — a pure read.
export const deriveKoRatingSimulation = (ko, gbrConfig, multiplier) => {
  const rows = [];
  const simulatedGbr = new Map(); // playerId -> this simulation's current GBR

  KO_STAGE_ORDER.forEach((stage) => {
    const stageState = ko[stage];
    if (!stageState) return;
    stageState.matches.forEach((m) => {
      const preA = stage === 'top16' || !simulatedGbr.has(m.p1.playerId) ? m.p1.gbr : simulatedGbr.get(m.p1.playerId);
      const preB = stage === 'top16' || !simulatedGbr.has(m.p2.playerId) ? m.p2.gbr : simulatedGbr.get(m.p2.playerId);

      let rawDelta = null;
      let appliedDelta = null;
      let postA = null;
      let postB = null;
      if (m.done) {
        // Same GBR_INTEGER_RULE as recordKoMatchResult() above — the
        // preview must behave EXACTLY like the real KO engine would if
        // `multiplier` were the actual configured weight (docs task
        // "CALIBRATION PREVIEW" — "represents exactly how that weighting
        // WOULD behave if used as the actual tournament setting"): one
        // rounding of the weighted delta, Player B gets the exact negative.
        rawDelta = gbrChange(preA, preB, m.r1, m.r2, gbrConfig);
        appliedDelta = Math.round(rawDelta * multiplier);
        postA = preA + appliedDelta;
        postB = preB - appliedDelta;
        simulatedGbr.set(m.p1.playerId, postA);
        simulatedGbr.set(m.p2.playerId, postB);
      }

      rows.push({
        stage,
        stageLabel: koResultsStageLabel(stage, m.matchNumber),
        matchNumber: m.matchNumber,
        tbl: m.tbl,
        target: KO_RACE_TO[stage],
        done: m.done,
        winnerPlayerId: m.winnerPlayerId,
        ...winnerIdentity(m),
        playerA: {
          playerId: m.p1.playerId, seed: m.p1.seed, name: m.p1.name,
          preGbr: preA, expectedPct: expectedScore(preA, preB, gbrConfig.d) * 100,
          score: m.r1, rawDelta, appliedDelta, postGbr: postA
        },
        playerB: {
          playerId: m.p2.playerId, seed: m.p2.seed, name: m.p2.name,
          preGbr: preB, expectedPct: expectedScore(preB, preA, gbrConfig.d) * 100,
          score: m.r2, rawDelta: rawDelta == null ? null : -rawDelta, appliedDelta: appliedDelta == null ? null : -appliedDelta, postGbr: postB
        }
      });
    });
  });

  return rows;
};

// Shared player-summary derivation (docs task item 29) — works identically
// on AUTHORITATIVE rows (buildKoResultsRows()) or SIMULATED rows
// (deriveKoRatingSimulation()), since both share the exact same row shape.
// This is the ONE summarization implementation, reused rather than
// duplicated per source (docs task item 20's "reuse the same low-level
// calculation helper" spirit, extended to this derivation too).
export const summarizeKoPlayersFromRows = (rows) => {
  const byPlayer = new Map();
  rows.forEach((r) => {
    [
      { side: r.playerA, isWinner: r.winnerSeed === r.playerA.seed },
      { side: r.playerB, isWinner: r.winnerSeed === r.playerB.seed }
    ].forEach(({ side: s, isWinner }) => {
      if (s.playerId == null) return;
      let entry = byPlayer.get(s.playerId);
      if (!entry) {
        entry = { playerId: s.playerId, name: s.name, koMatches: 0, koWins: 0, startGbr: s.preGbr, currentGbr: s.preGbr };
        byPlayer.set(s.playerId, entry);
      }
      entry.koMatches += 1;
      if (r.done) {
        if (isWinner) entry.koWins += 1;
        entry.currentGbr = s.postGbr;
      }
    });
  });
  return Array.from(byPlayer.values())
    .map((entry) => ({ ...entry, totalDeltaGbr: entry.currentGbr - entry.startGbr }))
    .sort((a, b) => b.totalDeltaGbr - a.totalDeltaGbr);
};

// ---------------------------------------------------------------------------
// KO Player Summary (docs task item 29/30) — one row per player who has
// appeared in ANY generated KO match, DERIVED fresh (no duplicate storage).
// `startGbr` is the GBR they entered their FIRST KO match with; `currentGbr`
// is their most recently applied post-match GBR (unchanged from `startGbr`
// if their current/only match isn't done yet); `totalDeltaGbr = currentGbr
// - startGbr` is the cumulative APPLIED (never raw) change across every KO
// match they've completed so far — the "tournament-winner inflation" figure
// item 29/30 asks for. Composed from buildKoResultsRows() + the shared
// summarizeKoPlayersFromRows() above — the AUTHORITATIVE summary is simply
// that shared summarizer applied to the authoritative rows; the calibration
// preview applies the exact same summarizer to deriveKoRatingSimulation()'s
// rows instead (see Top16Page.jsx) — one summarization implementation, two
// row sources.
// ---------------------------------------------------------------------------
export const buildKoPlayerSummary = (ko, gbrConfig) => summarizeKoPlayersFromRows(buildKoResultsRows(ko, gbrConfig));

// Derived, never separately stored (avoids a champion field going stale
// relative to a still-correctable Final result) — docs task item 27/28.
export const getKoChampion = (finalStage) => {
  if (!isKoStageComplete(finalStage)) return null;
  const match = finalStage.matches[0];
  const isP1Winner = match.winnerPlayerId === match.p1.playerId;
  const champion = isP1Winner ? match.p1 : match.p2;
  const runnerUp = isP1Winner ? match.p2 : match.p1;
  return {
    playerId: champion.playerId,
    name: champion.name,
    runnerUpId: runnerUp.playerId,
    runnerUpName: runnerUp.name,
    r1: match.r1,
    r2: match.r2
  };
};

// ---------------------------------------------------------------------------
// Bracket PROJECTION (director correction pass — "show the full tree at all
// times"). The full Top16 -> QF -> SF -> Final structure must be visible
// from the moment the event exists, WITHOUT generating QF/SF/Final match
// data early merely to render it — QF/SF/Final data is still only ever
// created by startKoStage() (unchanged rule). buildBracketProjection() is a
// pure, read-only DERIVATION that fills every one of the 15 bracket
// positions (8+4+2+1) with either:
//   - a REAL slot ({ real: true, match }) when that stage has actually been
//     generated, or
//   - a PROJECTED slot ({ real: false, match: null, top, bottom }) when it
//     hasn't — `top`/`bottom` are SlotParticipant values, never a fake
//     match object.
//
// SlotParticipant = { known: true, seed, name, playerId }
//                  | { known: false, sourceLabel: 'WINNER M3' | 'Awaiting Block A' }
//
// KEY RULE: a slot can only ever be resolved to a KNOWN participant via a
// REAL, DONE match (`slot.real && slot.match.done`) — a projected (not yet
// started) stage never has a "winner" to report, by definition, so it can
// never resolve the stage after it either. This is what makes progressive
// population work correctly: QF's own participants become known as soon as
// individual Top16 matches finish (even before QF itself starts — that's
// only a preview), but SF/Final stay fully unresolved until QF actually
// starts AND its matches are played, exactly matching "this visual
// population may happen BEFORE QF itself is operationally started... the
// real QF match is still generated when the director presses START
// QUARTERFINALS."
// ---------------------------------------------------------------------------

const STAGE_SHORT_CODE = { top16: 'M', quarterfinals: 'QF', semifinals: 'SF' };

const realSlotsFromStage = (stageState) =>
  stageState.matches.map((m) => ({ matchNumber: m.matchNumber, real: true, match: m }));

const resolvedParticipant = (prevSlot, sourceLabel) => {
  if (prevSlot.real && prevSlot.match.done) {
    const isP1Winner = prevSlot.match.winnerPlayerId === prevSlot.match.p1.playerId;
    const w = isP1Winner ? prevSlot.match.p1 : prevSlot.match.p2;
    return { known: true, seed: w.seed, name: w.name, playerId: w.playerId };
  }
  return { known: false, sourceLabel };
};

const projectedSlotsFromPrevious = (prevSlots, prevStageCode) => {
  const slots = [];
  for (let i = 0; i < prevSlots.length; i += 2) {
    const topSource = prevSlots[i];
    const bottomSource = prevSlots[i + 1];
    slots.push({
      matchNumber: slots.length + 1,
      real: false,
      match: null,
      top: resolvedParticipant(topSource, `WINNER ${prevStageCode}${topSource.matchNumber}`),
      bottom: resolvedParticipant(bottomSource, `WINNER ${prevStageCode}${bottomSource.matchNumber}`)
    });
  }
  return slots;
};

// `top16SeedPairings`: the 8 { matchNumber, top, bottom } pairs from
// getTop16Seeding(event) — top/bottom already either a real frozen
// Qualifier ({seed,playerId,name,gbr,...}) or a placeholder
// ({seed,placeholder:true,name:'Awaiting Block X',playerId:null}).
export const buildBracketProjection = (ko, top16SeedPairings) => {
  const top16 = ko.top16
    ? realSlotsFromStage(ko.top16)
    : top16SeedPairings.map((p) => ({
        matchNumber: p.matchNumber,
        real: false,
        match: null,
        top: p.top.placeholder ? { known: false, sourceLabel: `Awaiting Block ${p.top.seed[0]}` } : { known: true, seed: p.top.seed, name: p.top.name, playerId: p.top.playerId },
        bottom: p.bottom.placeholder ? { known: false, sourceLabel: `Awaiting Block ${p.bottom.seed[0]}` } : { known: true, seed: p.bottom.seed, name: p.bottom.name, playerId: p.bottom.playerId }
      }));

  const quarterfinals = ko.quarterfinals ? realSlotsFromStage(ko.quarterfinals) : projectedSlotsFromPrevious(top16, STAGE_SHORT_CODE.top16);
  const semifinals = ko.semifinals ? realSlotsFromStage(ko.semifinals) : projectedSlotsFromPrevious(quarterfinals, STAGE_SHORT_CODE.quarterfinals);
  const final = ko.final ? realSlotsFromStage(ko.final) : projectedSlotsFromPrevious(semifinals, STAGE_SHORT_CODE.semifinals);

  return { top16, quarterfinals, semifinals, final };
};
