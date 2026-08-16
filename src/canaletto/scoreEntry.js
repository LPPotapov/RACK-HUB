import { useEffect } from 'react';

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

// Publishes the CURRENT (r1, r2) local input pair as a live draft score
// whenever the pair is publishable, debounced ~150ms so a rapid run of
// native-number-input spinner clicks or keystrokes coalesces into one write
// rather than one per change (task requirement: "very small debounce",
// never multi-second latency).
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
//
// `enabled` gates the whole effect (callers pass `editing && !match.done` —
// see MatchRow/KoMatchCard — so a re-opened, already-official match being
// corrected does not start emitting drafts; see those components' own
// comments for why). `onPublish` is optional — omitting it (e.g. a caller
// with no live-state wiring available) makes this a complete no-op.
export const useDraftScorePublish = (enabled, r1, r2, onPublish) => {
  useEffect(() => {
    if (!enabled || !onPublish) return undefined;
    const bothBlank = String(r1 ?? '').trim() === '' && String(r2 ?? '').trim() === '';
    if (bothBlank) return undefined;
    const n1 = parseDraftScoreField(r1);
    const n2 = parseDraftScoreField(r2);
    if (n1 === null || n2 === null) return undefined;
    const timer = setTimeout(() => onPublish(n1, n2), 150);
    return () => clearTimeout(timer);
  }, [enabled, r1, r2, onPublish]);
};
