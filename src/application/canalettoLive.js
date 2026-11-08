// Canaletto LIVE / broadcast state — the operator's TV-match selection and
// a manually-controlled BROADCAST score for that match. Pure, Canaletto-
// specific, and deliberately its OWN small state, entirely separate from
// the authoritative CanalettoEvent (canalettoEvent.js): nothing in the
// STATE functions below (create/select/clear/setTvScore) ever mutates
// `event.ko`/block state, and no official command
// (recordKoResult/recordBlockMatchResult/etc.) ever reads this. This is
// what guarantees the streaming/broadcast score can never affect official
// tournament results — the two are structurally different objects with no
// shared mutation path, not merely "same object, please don't touch this
// field." resolveTvMatch()/getTvSelectableMatches() below DO read `event`
// (read-only queries), exactly like resolveTvMatch always has.
//
// CanalettoLiveState shape (plain JSON-safe data, like CanalettoEvent):
//   {
//     schemaVersion,
//     tvMatch: null
//       | { source: 'ko', stage: KoStageName, matchNumber }
//       | { source: 'block', block: 'A'|'B', roundNumber, matchId },
//     tvScores: { [tvMatchKey]: { r1, r2 } }   // BROADCAST-ONLY, PER-MATCH scores, always non-negative integers
//   }
//
// `tvMatch` is a POINTER into the authoritative event, never a copy of
// player/GBR/table data — resolveTvMatch() below reads the real match fresh
// from `event` every time, so it can never silently go stale relative to a
// table change, a score correction, or (for a not-yet-played match) simply
// not existing yet.
//
// LIVE/public correction pass: the TV ticker previously could only point at
// a generated KO match. The director needs it to work for the entire event
// — Block A/B Swiss matches too — so the pointer now carries an explicit
// `source` discriminant instead of assuming KO.
//
// Streaming-staff TV selection pass: streaming staff need to switch the TV
// match themselves (multiple cameras, no time to wait for the director), so
// selectTvMatch()/getTvSelectableMatches()/isSelectedTvRow() below are now
// shared by BOTH the director's LIVE page and the staff's TV Overlay Score
// Control page — ONE authoritative `tvMatch` pointer, never two. Because
// switching cameras must not blow away whatever score staff had already
// dialled in for a match they switch back to, the broadcast score is now
// PER MATCH (`tvScores`, keyed by tvMatchKey() below) instead of a single
// slot reset on every selection — selecting a match no longer resets a
// score, it just changes which key getCurrentTvScore()/setTvScore() read
// and write.

import { KO_RACE_TO, KO_STAGE_ORDER, top16SlotForMatch } from './canalettoKo.js';
import { getKoResultsRows } from './canalettoEvent.js';
import { expectedScore } from '../domain/fixedRackBbs.js';

export const CANALETTO_LIVE_SCHEMA_VERSION = 1;

// Ticker-specific stage wording (director correction pass item 4) —
// deliberately singular/short ("QUARTERFINAL", not the KO Results table's
// "Quarterfinals") to fit the ticker's compact left-metadata slot. Top16
// keeps its slot number, same source (top16SlotForMatch()) the KO Results
// table's own label already uses, just with a "·" separator instead of a
// space. This is ONLY used for resolveTvMatch()'s `sourceLabel` — the KO
// Results/calibration table's own stage labels (canalettoKo.js's
// koResultsStageLabel()) are untouched.
const KO_TICKER_STAGE_LABEL = {
  quarterfinals: 'QUARTERFINAL',
  semifinals: 'SEMIFINAL',
  final: 'FINAL'
};
const koTickerSourceLabel = (stage, matchNumber) => (
  stage === 'top16' ? `TOP16 · SLOT ${top16SlotForMatch(matchNumber)}` : KO_TICKER_STAGE_LABEL[stage]
);

// For THIS event, table "301 TV" is the preferred broadcast table — the
// director should still be free to put ANY current match on TV (Block or
// KO), so this is only ever used to make the match sitting on that table
// easy to spot in the selector, never to filter/restrict the selectable
// list (see getTvSelectableMatches() below).
export const PREFERRED_TV_TABLE_LABEL = '301 TV';

export const createCanalettoLiveState = () => ({
  schemaVersion: CANALETTO_LIVE_SCHEMA_VERSION,
  tvMatch: null,
  tvScores: {},
  liveDraftScores: {}
});

// Stable string key identifying a tvMatch pointer, used to store/retrieve
// that match's OWN broadcast score in `tvScores` — never a numeric index or
// array position (which could silently shift meaning), always this exact
// source+identity string.
export const tvMatchKey = (pointer) => {
  if (!pointer) return null;
  return pointer.source === 'ko'
    ? `ko:${pointer.stage}:${pointer.matchNumber}`
    : `block:${pointer.block}:${pointer.roundNumber}:${pointer.matchId}`;
};

const validateTvMatchPointer = (pointer) => {
  if (!pointer || typeof pointer !== 'object') return 'tvMatch pointer must be an object';
  if (pointer.source === 'ko') {
    if (!KO_STAGE_ORDER.includes(pointer.stage)) return `invalid stage "${pointer.stage}"`;
    if (!Number.isInteger(pointer.matchNumber) || pointer.matchNumber < 1) return 'matchNumber must be a positive integer';
    return null;
  }
  if (pointer.source === 'block') {
    if (pointer.block !== 'A' && pointer.block !== 'B') return 'block must be "A" or "B"';
    if (!Number.isInteger(pointer.roundNumber) || pointer.roundNumber < 1) return 'roundNumber must be a positive integer';
    if (pointer.matchId === undefined || pointer.matchId === null) return 'matchId is required';
    return null;
  }
  return 'pointer.source must be "ko" or "block"';
};

// Selecting a (new or previously-selected) TV match ONLY changes the
// pointer — it deliberately does NOT touch `tvScores`. A freshly-selected
// match that has no entry yet simply reads as 0-0 via getCurrentTvScore()
// below; a match switched back to keeps exactly the score it had before
// (per-match broadcast scores, streaming-staff correction pass item 5).
// Shared by the director's LIVE page AND the streaming staff's TV Overlay
// Score Control page — the SAME function, writing the SAME field, so
// whichever page calls this last is what the ticker shows next (item 1/7).
export const selectTvMatch = (liveState, pointer) => {
  const error = validateTvMatchPointer(pointer);
  if (error) throw new Error(`selectTvMatch: ${error}`);
  const tvMatch = pointer.source === 'ko'
    ? { source: 'ko', stage: pointer.stage, matchNumber: pointer.matchNumber }
    : { source: 'block', block: pointer.block, roundNumber: pointer.roundNumber, matchId: pointer.matchId };
  return { ...liveState, tvMatch };
};

export const clearTvMatch = (liveState) => ({ ...liveState, tvMatch: null });

// The BROADCAST score control (docs task: "separate score-control interface
// for the streaming team... independent of official tournament scoring").
// Deliberately permissive compared to the official race-to validation
// (isValidKoScore in canalettoKo.js) — this is a manual display aid for
// stream staff (e.g. showing an in-progress rack count before a rack is
// officially confirmed), not an authoritative result, so it only requires
// non-negative integers, never a race-to-target/winner check. Writes ONLY
// the CURRENTLY selected match's own entry in `tvScores` — every other
// match's stored score is untouched, so switching away and back restores it
// exactly (streaming-staff correction pass item 5).
export const setTvScore = (liveState, { r1, r2 }) => {
  if (!liveState.tvMatch) {
    throw new Error('setTvScore: no TV match is currently selected');
  }
  if (!Number.isInteger(r1) || r1 < 0) {
    throw new Error('setTvScore: r1 must be a non-negative integer');
  }
  if (!Number.isInteger(r2) || r2 < 0) {
    throw new Error('setTvScore: r2 must be a non-negative integer');
  }
  const key = tvMatchKey(liveState.tvMatch);
  return { ...liveState, tvScores: { ...liveState.tvScores, [key]: { r1, r2 } } };
};

// Reads the CURRENTLY selected match's own broadcast score — 0-0 when no
// match is selected, or when the selected match has no stored score yet
// (never selectTvMatch()'s job to pre-seed this; see above).
export const getCurrentTvScore = (liveState) => {
  if (!liveState.tvMatch) return { r1: 0, r2: 0 };
  return liveState.tvScores?.[tvMatchKey(liveState.tvMatch)] || { r1: 0, r2: 0 };
};

// ---------------------------------------------------------------------------
// LIVE DRAFT SCORE (livescore hotfix) — the tournament director's
// IN-PROGRESS score-entry value for a not-yet-confirmed Block or KO match,
// published to the public livescore page (and OBS bracket overlay) BEFORE
// Confirm/Complete Match is pressed. A DIFFERENT field from `tvScores`
// above (the streaming staff's independent manual TV ticker score) — but,
// since the TV/match ticker score-source fix, resolveTvDisplayScore() below
// now DOES read this as the TV overlay's preferred display value whenever
// the selected match isn't confirmed yet (official result still always
// wins once `done`; `tvScores` is only the last-resort fallback once
// neither official nor draft exists — see resolveTvDisplayScore()'s own
// header for the full precedence). Display-only either way: no official
// command (recordKoResult/recordBlockMatchResult/etc.) ever reads
// `liveDraftScores` — a draft can only ever become official through those
// existing commands themselves, which are always called with the
// score-entry component's own local input value, exactly as before this
// hotfix; this module never feeds a draft value into an official command.
//
// Keyed with the SAME matchPointer identity scheme as tvScores (tvMatchKey()
// above, reused as-is — one identity-keying implementation, not a second).
export const setLiveDraftScore = (liveState, pointer, { r1, r2 }) => {
  const error = validateTvMatchPointer(pointer);
  if (error) throw new Error(`setLiveDraftScore: ${error}`);
  if (!Number.isInteger(r1) || r1 < 0) {
    throw new Error('setLiveDraftScore: r1 must be a non-negative integer');
  }
  if (!Number.isInteger(r2) || r2 < 0) {
    throw new Error('setLiveDraftScore: r2 must be a non-negative integer');
  }
  const key = tvMatchKey(pointer);
  return {
    ...liveState,
    liveDraftScores: { ...liveState.liveDraftScores, [key]: { r1, r2, updatedAt: new Date().toISOString() } }
  };
};

// Best-effort hygiene, not a correctness requirement: display always prefers
// the draft only while the match is officially unconfirmed (`!match.done`,
// see koUi.jsx/ui.jsx), so a draft lingering here after its match is
// confirmed is never actually shown — this just keeps the stored map from
// growing unbounded over a long event. A pointer with no stored draft is a
// no-op (returns `liveState` unchanged, not an error).
export const clearLiveDraftScore = (liveState, pointer) => {
  const key = tvMatchKey(pointer);
  if (key == null || !liveState.liveDraftScores || !(key in liveState.liveDraftScores)) return liveState;
  const next = { ...liveState.liveDraftScores };
  delete next[key];
  return { ...liveState, liveDraftScores: next };
};

export const getLiveDraftScore = (liveState, pointer) => {
  const key = tvMatchKey(pointer);
  return (key && liveState.liveDraftScores?.[key]) || null;
};

// ---------------------------------------------------------------------------
// TV/match ticker SCORE-SOURCE FIX — resolves what the public TV overlay
// should actually display for the currently selected tvMatch, given THREE
// possible score sources that must never be conflated:
//   1. the OFFICIAL confirmed result (resolvedMatch.r1/r2, once `done`) —
//      ALWAYS wins once confirmed; never overridden by a draft or by the
//      independent manual `tvScores` value, which may still hold a stale
//      number from before confirmation.
//   2. the director's in-progress LIVE DRAFT (liveDraftScores, via the
//      SAME getLiveDraftScore()/tvMatchKey() identity every Block/KO match
//      card already uses — no second key format) — shown whenever the
//      match isn't done yet and a draft exists. This is what makes "a
//      director is mid-way through entering a score, before Confirm" show
//      up on the broadcast ticker, which previously never happened: this
//      field used to be read by the public Livescore page and the KO
//      bracket overlay, but NEVER by resolveTvMatch()/the TV overlay.
//   3. the independent, manual `tvScores` value (getCurrentTvScore() —
//      streaming staff's own deliberate broadcast-only override, settable
//      from TvScoreControlPage.jsx) — preserved as the LAST-RESORT
//      fallback, only ever shown when there is genuinely nothing more
//      authoritative (no official result, no draft) for this match. This
//      keeps the manual override useful (e.g. a match the director hasn't
//      touched yet, but staff want a specific number on screen) without
//      ever letting it mask a real official/draft score.
//   4. 0-0 if none of the above apply (resolvedMatch is null, or truly
//      nothing has ever been set).
//
// Purely a DISPLAY decision — this function never writes anything, never
// marks a match done, and never feeds into GBR/PERF/standings/KO
// advancement; it only decides which already-existing, already-authoritative
// value to read.
export const resolveTvDisplayScore = (resolvedMatch, liveState) => {
  if (!resolvedMatch) return { r1: 0, r2: 0 };
  if (resolvedMatch.done) return { r1: resolvedMatch.r1, r2: resolvedMatch.r2 };
  const draft = liveState.tvMatch && getLiveDraftScore(liveState, liveState.tvMatch);
  if (draft) return { r1: draft.r1, r2: draft.r2 };
  return getCurrentTvScore(liveState);
};

export const validateCanalettoLiveState = (state) => {
  const errors = [];
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    return { valid: false, errors: ['CanalettoLiveState must be a plain object'] };
  }
  if (state.tvMatch !== null && state.tvMatch !== undefined) {
    const error = validateTvMatchPointer(state.tvMatch);
    if (error) errors.push(`tvMatch: ${error}`);
  }
  const s = state.tvScores;
  if (typeof s !== 'object' || s === null || Array.isArray(s)) {
    errors.push('tvScores must be a plain object keyed by tvMatchKey()');
  } else {
    Object.entries(s).forEach(([key, v]) => {
      if (typeof v !== 'object' || v === null || !Number.isInteger(v.r1) || !Number.isInteger(v.r2) || v.r1 < 0 || v.r2 < 0) {
        errors.push(`tvScores["${key}"] must be { r1: non-negative integer, r2: non-negative integer }`);
      }
    });
  }
  // Optional (like tvScores would be for a state predating this field) — a
  // liveState persisted/synced before this hotfix won't have it yet, and
  // getLiveDraftScore()/setLiveDraftScore() already tolerate its absence, so
  // absence must never invalidate an otherwise-valid stored/synced state.
  if ('liveDraftScores' in state && state.liveDraftScores !== undefined) {
    const d = state.liveDraftScores;
    if (typeof d !== 'object' || d === null || Array.isArray(d)) {
      errors.push('liveDraftScores must be a plain object keyed by tvMatchKey() when present');
    } else {
      Object.entries(d).forEach(([key, v]) => {
        if (
          typeof v !== 'object' || v === null ||
          !Number.isInteger(v.r1) || !Number.isInteger(v.r2) || v.r1 < 0 || v.r2 < 0 ||
          typeof v.updatedAt !== 'string'
        ) {
          errors.push(`liveDraftScores["${key}"] must be { r1, r2: non-negative integers, updatedAt: string }`);
        }
      });
    }
  }
  return { valid: errors.length === 0, errors };
};

// Resolves the TV match's underlying OFFICIAL data fresh from the
// authoritative `event` every call — never a duplicated/cached copy. Only
// the SCORE shown on the overlay should come from getCurrentTvScore()
// instead of the official r1/r2; every other displayed field (names, GBR,
// table) is read directly from the real match. Returns null if no match is
// selected, or if the selected pointer no longer resolves (e.g. the stage
// was reset via the KO Danger Zone, or a bye slot, after being selected) —
// the caller should treat that exactly like "no TV match selected", never
// throw or show stale data.
//
// NORMALIZED return shape, deliberately IDENTICAL for a Block match and a
// KO match — this is what makes the ticker's left/right layout naturally
// symmetric (director correction pass item 12) instead of a component
// having to branch on p1.gbr vs p1.elo, seed vs no-seed, etc.:
//   {
//     source: 'ko' | 'block',
//     sourceLabel,   // e.g. 'TOP16 SLOT 1' / 'QUARTERFINALS' / 'BLOCK A · ROUND 3'
//     tbl,           // table label as currently assigned, or undefined
//     target,        // race-to target for this match (KO stage or block's max_games)
//     done,          // whether the OFFICIAL match result is confirmed (TV/match ticker
//                     // score-source fix — never a separate/looser "close enough" check)
//     r1, r2,        // the OFFICIAL match score (only meaningful once `done`)
//     p1: { name, gbr, winPct },
//     p2: { name, gbr, winPct }
//   }
export const resolveTvMatch = (event, liveState) => {
  const pointer = liveState.tvMatch;
  if (!pointer) return null;

  if (pointer.source === 'ko') {
    const stageState = event.ko[pointer.stage];
    if (!stageState) return null;
    const match = stageState.matches.find((m) => m.matchNumber === pointer.matchNumber);
    if (!match) return null;
    const gbrConfig = event.blockA.tournament.config;
    return {
      source: 'ko',
      sourceLabel: koTickerSourceLabel(pointer.stage, pointer.matchNumber),
      tbl: match.tbl,
      target: KO_RACE_TO[pointer.stage],
      done: match.done,
      r1: match.r1,
      r2: match.r2,
      p1: { name: match.p1.name, gbr: match.p1.gbr, winPct: expectedScore(match.p1.gbr, match.p2.gbr, gbrConfig.d) * 100 },
      p2: { name: match.p2.name, gbr: match.p2.gbr, winPct: expectedScore(match.p2.gbr, match.p1.gbr, gbrConfig.d) * 100 }
    };
  }

  if (pointer.source === 'block') {
    const tournament = event[`block${pointer.block}`]?.tournament;
    if (!tournament) return null;
    const match = (tournament.rounds[pointer.roundNumber] || []).find((m) => m.id === pointer.matchId);
    if (!match || match.bye) return null;
    const config = tournament.config;
    return {
      source: 'block',
      sourceLabel: `BLOCK ${pointer.block} · ROUND ${pointer.roundNumber}`,
      tbl: match.tbl,
      target: config.max_games,
      done: match.done,
      r1: match.r1,
      r2: match.r2,
      p1: { name: match.p1.name, gbr: match.p1.elo, winPct: expectedScore(match.p1.elo, match.p2.elo, config.d) * 100 },
      p2: { name: match.p2.name, gbr: match.p2.elo, winPct: expectedScore(match.p2.elo, match.p1.elo, config.d) * 100 }
    };
  }

  return null;
};

// ---------------------------------------------------------------------------
// TV match selector list (LIVE milestone, director correction pass item 15;
// also the data source for the streaming staff's own selector — same list,
// same rows, same selectTvMatch() call, so both pickers are guaranteed to
// offer/agree on the identical set of current matches) — the FULL set of
// currently-eligible matches the director OR streaming staff can put on TV,
// spanning Block A/B's CURRENT round (a not-yet-generated or already-
// superseded round is not "current" and is deliberately excluded — this is
// a live TV picker, not a historical browser) plus every generated KO
// stage's matches (reuses getKoResultsRows() — already covers Top16/QF/SF/
// Final, whichever stages currently exist in `event.ko`). A bye has no
// second player to put on TV and is excluded. Purely derived, read-only —
// never stores a duplicate of anything in `event`.
export const getTvSelectableMatches = (event) => {
  const rows = [];

  ['A', 'B'].forEach((block) => {
    if (event[`block${block}Lock`]) return; // locked block — no longer "current/operational"
    const tournament = event[`block${block}`].tournament;
    const roundNumber = tournament.currentRound;
    if (!roundNumber || roundNumber < 1) return;
    (tournament.rounds[roundNumber] || []).forEach((m) => {
      if (m.bye) return;
      rows.push({
        source: 'block',
        block,
        roundNumber,
        matchId: m.id,
        sourceLabel: `BLOCK ${block} · ROUND ${roundNumber}`,
        tbl: m.tbl,
        isPreferredTable: m.tbl === PREFERRED_TV_TABLE_LABEL,
        p1Name: m.p1.name,
        p2Name: m.p2.name
      });
    });
  });

  getKoResultsRows(event).forEach((r) => {
    rows.push({
      source: 'ko',
      stage: r.stage,
      matchNumber: r.matchNumber,
      sourceLabel: r.stageLabel,
      tbl: r.tbl,
      isPreferredTable: r.tbl === PREFERRED_TV_TABLE_LABEL,
      p1Name: r.playerA.name,
      p2Name: r.playerB.name
    });
  });

  return rows;
};

// Matches the pointer stored in `liveState.tvMatch` against a row from
// getTvSelectableMatches() — small shared equality check so the selector UI
// never re-implements this comparison inline.
export const isSelectedTvRow = (tvMatch, row) => {
  if (!tvMatch || tvMatch.source !== row.source) return false;
  if (row.source === 'ko') return tvMatch.stage === row.stage && tvMatch.matchNumber === row.matchNumber;
  return tvMatch.block === row.block && tvMatch.roundNumber === row.roundNumber && tvMatch.matchId === row.matchId;
};
