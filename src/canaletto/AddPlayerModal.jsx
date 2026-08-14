import { useState } from 'react';
import { ActionButton } from './ui.jsx';

// Mid-tournament late-entrant add (director correction pass, items 20/22):
// shown from a RUNNING block's round screen. Confirmation shows name, GBR,
// and which round they join from — director-supplied GBR is used as-is
// (reusing the existing pendingPlayers -> next-round promotion mechanism).
export const AddPlayerModal = ({ nextRound, onConfirm, onClose }) => {
  const [name, setName] = useState('');
  const [elo, setElo] = useState('1500');
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-md rounded border border-canaletto-border bg-canaletto-panel p-5">
        <h2 className="mb-3 font-condensed text-2xl font-black uppercase text-canaletto-cream">Add Player</h2>

        {!confirming ? (
          <>
            <div className="space-y-3">
              <label className="block">
                <div className="mb-1 font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-lavender">Name</div>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="block">
                <div className="mb-1 font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-lavender">GBR</div>
                <input className="input" value={elo} onChange={(e) => setElo(e.target.value)} />
              </label>
              <div className="text-xs text-canaletto-lavender">Joins from Round {nextRound}.</div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <ActionButton variant="outline" onClick={onClose}>Cancel</ActionButton>
              <ActionButton variant="gold" disabled={!name.trim()} onClick={() => setConfirming(true)}>
                Continue
              </ActionButton>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 rounded border border-canaletto-border bg-canaletto-panel2 p-3 text-sm">
              <div className="font-semibold text-canaletto-cream">{name.trim()}</div>
              <div className="text-canaletto-lavender">GBR {parseInt(elo, 10) || 1500}</div>
              <div className="mt-1 text-canaletto-gold">Joins from Round {nextRound}</div>
            </div>
            <div className="flex justify-end gap-2">
              <ActionButton variant="outline" onClick={() => setConfirming(false)}>Back</ActionButton>
              <ActionButton
                variant="gold"
                onClick={() => {
                  onConfirm({ name: name.trim(), elo: parseInt(elo, 10) || 1500 });
                  onClose();
                }}
              >
                Add Player
              </ActionButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
