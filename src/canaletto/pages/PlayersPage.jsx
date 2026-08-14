import { useRef, useState } from 'react';
import {
  addPlayerToBlock,
  getBlockStatus,
  removePlayerFromBlock,
  startBlock
} from '../../application/canalettoEvent.js';
import { ActionButton, PageHeader, StatusBadge } from '../ui.jsx';

let nextIdCounter = 1;
const nextPlayerId = (roster) => {
  const max = roster.reduce((m, p) => (typeof p.id === 'number' && p.id > m ? p.id : m), 0);
  nextIdCounter = Math.max(nextIdCounter, max + 1);
  return nextIdCounter++;
};

// Shared line-based parser for both the bulk-paste textarea and CSV import:
// each line is "Name,GBR" (or just "Name"). A leading header row
// (first cell "name", case-insensitive — the actual header used by the
// real Canaletto Block A/B roster CSVs) is skipped automatically.
const parsePlayerLines = (text) => {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines
    .filter((line, i) => !(i === 0 && line.split(',')[0].trim().toLowerCase() === 'name'))
    .map((line) => {
      const [rawName, rawElo] = line.split(',').map((s) => s.trim());
      return rawName ? { name: rawName, elo: parseInt(rawElo, 10) || 1500 } : null;
    })
    .filter(Boolean);
};

const BlockColumn = ({ event, run, block, onNavigate }) => {
  const applicationState = event[`block${block}`];
  const roster = applicationState.tournament.roster;
  const status = getBlockStatus(event, block);
  const editable = status === 'NOT_STARTED';

  const [name, setName] = useState('');
  const [elo, setElo] = useState('1500');
  const [bulk, setBulk] = useState('');
  const fileInputRef = useRef(null);

  const addOne = () => {
    if (!name.trim()) return;
    run(addPlayerToBlock, block, { id: nextPlayerId(roster), name: name.trim(), elo: parseInt(elo, 10) || 1500 });
    setName('');
    setElo('1500');
  };

  const addParsedPlayers = (parsed) => {
    let current = roster;
    parsed.forEach(({ name: playerName, elo: playerElo }) => {
      const player = { id: nextPlayerId(current), name: playerName, elo: playerElo };
      current = [...current, player];
      run(addPlayerToBlock, block, player);
    });
  };

  const addBulk = () => {
    addParsedPlayers(parsePlayerLines(bulk));
    setBulk('');
  };

  const importCsvFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addParsedPlayers(parsePlayerLines(String(reader.result)));
    reader.readAsText(file);
  };

  return (
    <div className={`rounded border bg-canaletto-panel ${block === 'B' ? 'border-canaletto-magenta/60' : 'border-canaletto-border'}`}>
      <div className="flex items-center justify-between border-b border-canaletto-border px-4 py-3">
        <h2 className="font-condensed text-2xl font-black uppercase tracking-wide text-canaletto-cream">Block {block}</h2>
        <StatusBadge status={status} />
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-canaletto-panel">
            <tr className="border-b border-canaletto-border text-xs font-bold uppercase tracking-widest text-canaletto-lavender">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2 text-right">GBR</th>
              {editable && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {roster.map((p, i) => (
              <tr key={p.id} className="border-b border-canaletto-border/50">
                <td className="px-3 py-2 text-canaletto-lavender">{i + 1}</td>
                <td className="px-3 py-2 font-semibold text-canaletto-cream">{p.name}</td>
                <td className="px-3 py-2 text-right font-bold text-canaletto-gold">{p.elo}</td>
                {editable && (
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => run(removePlayerFromBlock, block, p.id)}
                      className="text-xs font-bold uppercase text-canaletto-magenta hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-canaletto-border px-4 py-3 font-condensed text-sm font-bold uppercase tracking-widest text-canaletto-lavender">
        {roster.length} Players
      </div>

      {editable && (
        <div className="space-y-3 border-t border-canaletto-border px-4 py-4">
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input w-24" placeholder="GBR" value={elo} onChange={(e) => setElo(e.target.value)} />
            <ActionButton variant="outline" className="px-3 py-2 text-xs" onClick={addOne}>Add</ActionButton>
          </div>
          <div>
            <textarea
              className="input h-20 font-mono text-xs"
              placeholder={'Bulk paste: one player per line, "Name, GBR"'}
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={addBulk}>Add Bulk List</ActionButton>
              <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={() => fileInputRef.current?.click()}>
                Import CSV
              </ActionButton>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  importCsvFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
          <ActionButton
            variant={block === 'B' ? 'magenta' : 'gold'}
            className="w-full"
            disabled={roster.length === 0}
            onClick={() => {
              const ok = run(startBlock, block);
              if (ok) onNavigate(`block${block}`);
            }}
          >
            Start Block {block}
          </ActionButton>
        </div>
      )}
    </div>
  );
};

export const PlayersPage = ({ event, run, onNavigate }) => (
  <div>
    <PageHeader eyebrow="Roster" title="Block A and Block B" subtitle="Register players separately for each block before it starts." />
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <BlockColumn event={event} run={run} block="A" onNavigate={onNavigate} />
      <BlockColumn event={event} run={run} block="B" onNavigate={onNavigate} />
    </div>
  </div>
);
