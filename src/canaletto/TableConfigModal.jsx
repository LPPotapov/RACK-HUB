import { useRef, useState } from 'react';
import { parseManualTableList, parseTableCsv, tableLabels } from '../application/canalettoTables.js';
import { ActionButton } from './ui.jsx';

// Compact modal for the shared, event-level, ordered table list (director
// correction pass — previously a large permanent textarea on the round
// screen). Available from Event Settings, before either block starts.
// Supports manual one-per-line entry AND BillardPad CSV import
// (order,table,id,score_link) — only `label` is ever handed to the
// canonical BBS layer; billardPadId/scoreLink are preserved as inert
// metadata for the future livescore task.
export const TableConfigModal = ({ tables, onSave, onClose }) => {
  const [manual, setManual] = useState(tableLabels(tables).join('\n'));
  const [preview, setPreview] = useState(tables);
  const fileInputRef = useRef(null);

  const applyManualText = (text) => {
    setManual(text);
    setPreview(parseManualTableList(text));
  };

  const importCsv = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseTableCsv(String(reader.result));
      setPreview(parsed);
      setManual(tableLabels(parsed).join('\n'));
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-xl rounded border border-canaletto-border bg-canaletto-panel p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-condensed text-2xl font-black uppercase text-canaletto-cream">Table Configuration</h2>
          <button type="button" onClick={onClose} className="font-condensed text-xs font-bold uppercase text-canaletto-lavender hover:text-canaletto-cream">
            Close
          </button>
        </div>
        <div className="mb-2 text-xs text-canaletto-lavender">
          One table per line, in the order they should be used — order is preserved exactly, never sorted.
        </div>
        <textarea
          className="input h-40 font-mono text-xs"
          value={manual}
          onChange={(e) => applyManualText(e.target.value)}
          placeholder={'301 TV\n302\n303'}
        />
        <div className="mt-2 flex items-center gap-2">
          <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={() => fileInputRef.current?.click()}>
            Import CSV
          </ActionButton>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              importCsv(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <span className="text-xs text-canaletto-lavender">{preview.length} tables configured</span>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <ActionButton variant="outline" onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            variant="gold"
            onClick={() => {
              onSave(preview);
              onClose();
            }}
          >
            Save
          </ActionButton>
        </div>
      </div>
    </div>
  );
};
