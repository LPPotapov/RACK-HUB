import { useState } from 'react';
import { ActionButton } from './ui.jsx';

// Emergency manual re-pairing of the CURRENT round's still-open
// (uncompleted) matches only (director correction pass, items 17-19).
// Completed matches are never passed in here at all — `openMatches` is
// already filtered by the caller (BlockPage.jsx) to done:false/cancelled:
// false/bye:false, matching exactly what applyBlockManualPairings()'s pure
// data-layer operation itself accepts.
//
// Repeat-opponent detection here is informational only (a warning badge) —
// the underlying command deliberately does not block it; the director may
// explicitly confirm an emergency repeat pairing.
export const ManualPairingModal = ({ openMatches, roundNumber, onApply, onClose }) => {
  const openPlayers = openMatches.flatMap((m) => [m.p1, m.p2]);
  const [assignments, setAssignments] = useState(
    openMatches.map((m) => ({ matchId: m.id, tbl: m.tbl, p1Id: m.p1.id, p2Id: m.p2.id }))
  );
  const [confirming, setConfirming] = useState(false);

  const setSide = (matchId, side, playerId) => {
    setAssignments((prev) => prev.map((a) => (a.matchId === matchId ? { ...a, [side]: playerId } : a)));
  };

  // <select> options always round-trip through a STRING value regardless of
  // the player id's real type — resolve back to the ORIGINAL id (whatever
  // type it is) via the open-player pool, never guess-coerce it.
  const resolvePlayerId = (stringValue) => openPlayers.find((p) => String(p.id) === stringValue)?.id;

  const isRepeat = (a) => {
    const p1 = openPlayers.find((p) => p.id === a.p1Id);
    return !!p1?.opps?.includes(a.p2Id);
  };

  const submit = () => {
    const pairings = assignments.map(({ matchId, p1Id, p2Id }) => ({ matchId, p1Id, p2Id }));
    const ok = onApply(pairings);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-2xl rounded border border-canaletto-border bg-canaletto-panel p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-condensed text-2xl font-black uppercase text-canaletto-cream">Edit Pairings — Round {roundNumber}</h2>
          <button type="button" onClick={onClose} className="font-condensed text-xs font-bold uppercase text-canaletto-lavender hover:text-canaletto-cream">
            Close
          </button>
        </div>
        <div className="mb-3 text-xs text-canaletto-lavender">
          Rearrange only these still-open matches. Completed matches are locked and not shown.
        </div>

        <div className="max-h-96 space-y-2 overflow-y-auto">
          {assignments.map((a) => (
            <div key={a.matchId} className="flex items-center gap-2 rounded border border-canaletto-border bg-canaletto-panel2 p-2">
              <span className="w-14 shrink-0 font-condensed text-xs font-bold text-canaletto-gold">{a.tbl ?? '—'}</span>
              <select className="input flex-1" value={String(a.p1Id)} onChange={(e) => setSide(a.matchId, 'p1Id', resolvePlayerId(e.target.value))}>
                {openPlayers.map((p) => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
              </select>
              <span className="text-canaletto-lavender">vs</span>
              <select className="input flex-1" value={String(a.p2Id)} onChange={(e) => setSide(a.matchId, 'p2Id', resolvePlayerId(e.target.value))}>
                {openPlayers.map((p) => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
              </select>
              {isRepeat(a) && (
                <span className="shrink-0 font-condensed text-[10px] font-bold uppercase text-canaletto-magenta">Repeat</span>
              )}
            </div>
          ))}
        </div>

        {confirming ? (
          <div className="mt-4 rounded border border-canaletto-magenta/60 bg-canaletto-panel2 p-3">
            <div className="mb-2 text-sm font-semibold text-canaletto-cream">Apply manual pairings to Round {roundNumber}?</div>
            <div className="flex gap-2">
              <ActionButton variant="magenta" onClick={submit}>Confirm</ActionButton>
              <ActionButton variant="outline" onClick={() => setConfirming(false)}>Back</ActionButton>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex justify-end gap-2">
            <ActionButton variant="outline" onClick={onClose}>Cancel</ActionButton>
            <ActionButton variant="gold" onClick={() => setConfirming(true)}>Save &amp; Apply Pairings</ActionButton>
          </div>
        )}
      </div>
    </div>
  );
};
