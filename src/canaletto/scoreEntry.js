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
