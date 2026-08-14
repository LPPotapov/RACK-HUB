// Pure UI-draft-state helper for KO race-to score entry — deliberately NOT
// scoreEntry.js's resolveScoreField(): fixed-rack blank-side autocomplete
// (blank -> 0) does not apply to a knockout race-to match (docs task item
// 15). Both fields are always required; a blank/non-integer/out-of-range
// field means "not ready to submit" rather than "assume 0".
//
//   ''/'  '   -> null (not ready)
//   '4.5'     -> null (not an integer)
//   'abc'     -> null
//   '6'       -> 6
export const parseKoScoreField = (raw) => {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isInteger(n) ? n : null;
};
