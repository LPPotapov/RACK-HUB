// Pure UI-draft-state helper (director correction pass): converts a raw
// score input string into the canonical missing-side value
// recordMatchResult() already expects (0), WITHOUT weakening that command's
// strict integer contract and WITHOUT duplicating its autocomplete formula —
// recordMatchResult() itself still decides whether a lone entered score
// autocompletes the opposite side.
//
//   ''/'  '  -> 0   (untouched/blank field — the canonical "missing" value)
//   '6'      -> 6
//   '4.5'    -> null (not an integer — caller must not submit)
//   'abc'    -> null
export const resolveScoreField = (raw) => {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return 0;
  const n = Number(trimmed);
  return Number.isInteger(n) ? n : null;
};

// ---------------------------------------------------------------------------
// LIVE DRAFT publishing (livescore hotfix, urgent bugfix pass) — separate
// from the two parsers above on purpose, but NOW deliberately matching
// resolveScoreField()'s blank->0 convention rather than inventing a
// stricter one: a fixed-rack OR race-to match is, in reality, "0-0" from
// the moment it exists, so the side the director hasn't touched yet reads
// as 0 the same way the scoreboard/Confirm flow already treats it — never a
// SEPARATE "blocked/no-value" state. The bugfix-pass root cause (see the
// livescore live-draft investigation report) was exactly the PRIOR version
// of this parser returning `null` for a blank field: a director clicking
// the native number input's up-arrow on ONLY one side (the other left
// blank, e.g. "0-0" -> click up -> "1-0") left the OTHER side blank ->
// useDraftScorePublish's old "both sides must be non-null" gate silently
// never published ANYTHING — the exact end-to-end break reported ("input
// changes, public livescore does not"). A genuinely non-negative-integer
// value is never blocked; only a NEGATIVE or otherwise malformed
// (non-integer/non-numeric) value is rejected, since that must never reach
// the public page as tournament data.
//
//   ''/'  '   -> 0   (untouched side of an in-progress draft — same "0-0
//                      until touched" reading resolveScoreField() already
//                      uses at final Confirm for a fixed-rack match)
//   '-1'      -> null (negative — do not publish)
//   '4.5'     -> null (not an integer — do not publish)
//   'abc'     -> null
//   '6'       -> 6
export const parseDraftScoreField = (raw) => {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return 0;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

// Decides whether the CURRENT (r1, r2) local input pair is publishable as a
// live draft score, and if so returns the parsed [n1, n2] pair — otherwise
// null.
//
// "Publishable" is deliberately NOT simply "both sides parse" (with the
// blank->0 rule above, that would be true even before the director has
// touched EITHER field, since both start blank on mount — every pending
// match in a round would auto-publish a "0-0" draft the instant its card
// merely renders, flooding Firebase and replacing the normal "vs"
// placeholder for matches nobody is actually scoring). Instead: skip
// entirely while BOTH sides are still genuinely blank (untouched), then
// publish as soon as AT LEAST ONE side has been entered (the other reading
// 0 per parseDraftScoreField above) — this is exactly "0-0 -> click up ->
// 1-0" from the bugfix-pass acceptance test. Still never publishes while
// either NON-blank side is malformed/negative (see parseDraftScoreField).
export const draftScorePublishPair = (r1, r2) => {
  const bothBlank = String(r1 ?? '').trim() === '' && String(r2 ?? '').trim() === '';
  if (bothBlank) return null;
  const n1 = parseDraftScoreField(r1);
  const n2 = parseDraftScoreField(r2);
  if (n1 === null || n2 === null) return null;
  return [n1, n2];
};

// LIVE DRAFT publishing, direct-handler pass (urgent hotfix — see the
// live-draft investigation report): the PRIOR implementation was a
// useEffect watching [r1, r2], set-timeout-debounced 150ms. Retested against
// canalettoTest, native number-input stepper clicks did not reliably reach
// the public page end-to-end through that effect indirection. This version
// is called DIRECTLY from the score field's own onChange handler — the same
// call stack that receives the browser's input event is the one that calls
// setLiveDraftScore, with no intervening effect/dependency-array/timer to
// possibly miss a value. Firebase-write coalescing still happens (the
// existing 200ms LIVE_DRAFT_MIRROR_DEBOUNCE_MS in useCanalettoCloudMirror.js
// — untouched by this change), so a rapid run of clicks still produces one
// write, not one per click; this only removes the SEPARATE, redundant
// 150ms UI-side debounce that sat between the input event and the draft
// setter.
//
// `lastPublishedRef` is a `useRef(null)`, OWNED AND PERSISTED by the caller
// (one per match-card instance) — a small equality guard so an onChange
// firing with an unchanged value never re-publishes/re-writes the identical
// pair. It must be reset (`.current = null`) whenever the card's own
// r1/r2/editing state resets (see MatchRow/KoMatchCard's existing sync
// effect) so a genuinely new editing session is never blocked by a stale
// value left over from a previous match/session.
//
// `onPublish` optional (e.g. a caller with no live-state wiring) makes this
// a complete no-op, same contract as before.
export const publishDraftScoreChange = (nextR1, nextR2, lastPublishedRef, onPublish) => {
  if (!onPublish) return;
  const pair = draftScorePublishPair(nextR1, nextR2);
  if (!pair) return;
  const [n1, n2] = pair;
  const last = lastPublishedRef.current;
  if (last && last.r1 === n1 && last.r2 === n2) return;
  lastPublishedRef.current = { r1: n1, r2: n2 };
  onPublish(n1, n2);
};
