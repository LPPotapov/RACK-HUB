// Canaletto event table configuration (director correction pass): pure
// parsing helpers for the shared, event-level, ordered table list. Preserves
// file/paste order exactly — never sorts alphabetically/numerically.
//
// Table shape: { order, label, billardPadId, scoreLink }
//   order        - 1-based position, taken from row/line SEQUENCE, not from
//                   any value inside the row itself (keeps ordering
//                   deterministic even if a CSV's own "order" column has
//                   gaps/duplicates/is missing)
//   label         - the only field the canonical BBS layer ever reads
//                   (assignMatchTable()/generatePairings()'s `tbl`) — plain
//                   string, never coerced to a number, alphanumeric allowed
//   billardPadId  - BillardPad "id" column, preserved only for the future
//                   livescore task; no canonical BBS code reads this
//   scoreLink     - BillardPad "score_link" column, same as above
//
// Pure: no DOM/File APIs — callers read a File via FileReader and pass the
// resulting text in.

const createTable = (order, label, billardPadId = null, scoreLink = null) => ({
  order,
  label,
  billardPadId,
  scoreLink
});

// Manual entry: one table label per line. Blank lines ignored.
export const parseManualTableList = (text) =>
  String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label, i) => createTable(i + 1, label));

// BillardPad CSV export: order,table,id,score_link. A leading header row
// (first cell "order", case-insensitive) is skipped automatically. Only the
// `table` column is required per row — `id`/`score_link` are optional
// BillardPad metadata, preserved verbatim when present.
export const parseTableCsv = (text) => {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const dataLines = lines.filter((line, i) => !(i === 0 && line.split(',')[0].trim().toLowerCase() === 'order'));
  return dataLines
    .map((line) => line.split(',').map((cell) => cell.trim()))
    .filter((cells) => cells[1])
    .map((cells, i) => createTable(i + 1, cells[1], cells[2] || null, cells[3] || null));
};

// The only projection the canonical BBS layer (assignMatchTable/
// generatePairings' `tableNumbers`) is ever given — labels only, in
// preserved order.
export const tableLabels = (tables) => tables.map((t) => t.label);
