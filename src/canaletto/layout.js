// Pure layout-data helper (operator-control pass, item 1): splits an
// ALREADY-RANKED array into two visual columns for a compact two-column
// standings display (e.g. ranks 1-16 | 17-32) WITHOUT re-sorting either
// half — this is one continuous official ranking, merely displayed in two
// columns. For an odd count, the left column gets the extra row.
export const splitForTwoColumnDisplay = (rows) => {
  const mid = Math.ceil(rows.length / 2);
  return [rows.slice(0, mid), rows.slice(mid)];
};
