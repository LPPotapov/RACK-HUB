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
// LIVE DRAFT publishing (livescore hotfix) — separate from the two parsers
// above on purpose: neither resolveScoreField()'s blank->0 autocomplete
// (fixed-rack, final-submit only) nor koScoreEntry.js's parseKoScoreField()
// (blank->null, but still accepts a negative value, since final submission
// already re-validates via isValidKoScore()) is the right rule for a value
// about to be PUBLISHED LIVE, unconfirmed, to the public page — a blank
// field must never flash as a public "0", and a negative value must never
// be published at all. This is deliberately its own strict parser.
//
//   ''/'  '   -> null (temporary editing state — do not publish)
//   '-1'      -> null (negative — do not publish)
//   '4.5'     -> null (not an integer — do not publish)
//   'abc'     -> null
//   '6'       -> 6
export const parseDraftScoreField = (raw) => {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

// Publishes the CURRENT (r1, r2) local input pair as a live draft score
// whenever BOTH sides parse to a valid non-negative integer, debounced
// ~150ms so a rapid run of native-number-input spinner clicks or keystrokes
// coalesces into one write rather than one per change (task requirement:
// "very small debounce", never multi-second latency). Silently skips
// publishing while either side is a temporary invalid/blank editing state
// (see parseDraftScoreField above) — never publishes a fabricated 0, and
// never blocks the input from staying freely editable. `enabled` gates the
// whole effect (callers pass `editing && !match.done` — see MatchRow/
// KoMatchCard — so a re-opened, already-official match being corrected does
// not start emitting drafts; see those components' own comments for why).
// `onPublish` is optional — omitting it (e.g. a caller with no live-state
// wiring available) makes this a complete no-op.
export const useDraftScorePublish = (enabled, r1, r2, onPublish) => {
  useEffect(() => {
    if (!enabled || !onPublish) return undefined;
    const n1 = parseDraftScoreField(r1);
    const n2 = parseDraftScoreField(r2);
    if (n1 === null || n2 === null) return undefined;
    const timer = setTimeout(() => onPublish(n1, n2), 150);
    return () => clearTimeout(timer);
  }, [enabled, r1, r2, onPublish]);
};
