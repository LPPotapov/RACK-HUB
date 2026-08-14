import { useState } from 'react';
import {
  canResetBlockTournament,
  canUnlockBlock,
  resetBlockCurrentRound,
  resetBlockTournament,
  unlockBlock
} from '../application/canalettoEvent.js';
import { ActionButton } from './ui.jsx';
import { TypedConfirmModal } from './TypedConfirmModal.jsx';

// Compact, clearly-separated Danger Zone (director correction pass, item
// 24): Reset Current Round, Reset Block Tournament, Unlock Block Results —
// each behind a typed-confirmation modal (TypedConfirmModal). Never placed
// next to ordinary navigation/actions.
export const DangerZone = ({ event, run, block, status, currentRound }) => {
  const [modal, setModal] = useState(null); // 'resetRound' | 'resetBlock' | 'unlock' | null

  const unlockEligibility = canUnlockBlock(event, block);
  const resetBlockEligibility = canResetBlockTournament(event, block);

  return (
    <div className="mt-8 rounded border-2 border-canaletto-magenta/40 bg-canaletto-magenta/5 p-4">
      <div className="mb-1 font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-magenta">Danger Zone</div>
      <div className="mb-3 text-xs text-canaletto-lavender">Destructive operator controls — each requires typed confirmation.</div>
      <div className="flex flex-wrap gap-2">
        {status === 'RUNNING' && (
          <ActionButton variant="danger" onClick={() => setModal('resetRound')}>Reset Current Round</ActionButton>
        )}
        {status === 'LOCKED' && (
          <ActionButton variant="danger" disabled={!unlockEligibility.ok} onClick={() => setModal('unlock')}>
            Unlock Block Results
          </ActionButton>
        )}
        <ActionButton variant="danger" disabled={!resetBlockEligibility.ok} onClick={() => setModal('resetBlock')}>
          Reset Block {block} Tournament
        </ActionButton>
      </div>
      {status === 'LOCKED' && !unlockEligibility.ok && (
        <div className="mt-2 text-xs text-canaletto-lavender">{unlockEligibility.reason}</div>
      )}
      {!resetBlockEligibility.ok && <div className="mt-2 text-xs text-canaletto-lavender">{resetBlockEligibility.reason}</div>}

      {modal === 'resetRound' && (
        <TypedConfirmModal
          title={`Reset Round ${currentRound}`}
          warning={`This erases every entered result, missing-player designation, and manual pairing change for Round ${currentRound}, then regenerates it from the standings immediately before this round. Earlier rounds are not affected.`}
          phrase={`RESET ROUND ${currentRound}`}
          confirmLabel="Reset Round"
          onConfirm={() => run(resetBlockCurrentRound, block)}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'unlock' && (
        <TypedConfirmModal
          title={`Unlock Block ${block}`}
          warning={`This clears Block ${block}'s locked state and its frozen qualifier list, and removes any populated Top 16 seed names sourced from it. Rounds and results are preserved — score corrections become possible again.`}
          phrase={`UNLOCK BLOCK ${block}`}
          confirmLabel="Unlock"
          onConfirm={() => run(unlockBlock, block)}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'resetBlock' && (
        <TypedConfirmModal
          title={`Reset Block ${block} Tournament`}
          warning={`This deletes all played rounds and results for Block ${block} and returns it to not-started. Its assigned player list, GBRs, event settings, and table configuration are kept. This cannot be undone.`}
          phrase={`RESET BLOCK ${block}`}
          confirmLabel="Reset Block"
          onConfirm={() => run(resetBlockTournament, block)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
};
