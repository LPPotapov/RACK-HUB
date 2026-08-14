import { useState } from 'react';
import { canResetTop16, getTop16Seeding, getTop16Status, resetTop16, startTop16 } from '../../application/canalettoEvent.js';
import { ActionButton, PageHeader, Panel, StatusBadge } from '../ui.jsx';
import { TypedConfirmModal } from '../TypedConfirmModal.jsx';

const WAITING_COPY = {
  WAITING_FOR_BOTH: 'Waiting for both blocks to be locked.',
  WAITING_FOR_A: 'Block B is locked. Waiting for Block A.',
  WAITING_FOR_B: 'Block A is locked. Waiting for Block B.'
};

// 3rd director correction pass (items 2/25): Top16 populated seed names use
// NORMAL cream/gold Canaletto styling — NOT magenta. Magenta locked-player
// styling is reserved exclusively for Results/standings tables
// (getBlockResultsRows()'s lockedQualifier flag, see BlockPage.jsx). A prior
// pass added magenta here; that has been reverted.
const SeedSlot = ({ seed, align }) => (
  <div className={align === 'right' ? 'text-right' : 'text-left'}>
    <div className={`font-condensed text-sm font-black ${seed.placeholder ? 'text-canaletto-lavender' : 'text-canaletto-gold'}`}>{seed.seed}</div>
    <div className={`font-semibold ${seed.placeholder ? 'italic text-canaletto-lavender' : 'text-canaletto-cream'}`}>
      {seed.name}
    </div>
    {!seed.placeholder && <div className="text-xs text-canaletto-lavender">GBR {Math.round(seed.gbr)}</div>}
  </div>
);

// Always visible — director correction pass: shows the fixed 8-slot bracket
// shape (A1vB8, B1vA8, ...) from the moment the event exists, filling in
// whichever block(s) have locked so far via getTop16Seeding() (lenient —
// unlike the strict computeTop16Seeding() used only to gate startTop16()).
const SeedCard = ({ pairing }) => (
  <div className="rounded border border-canaletto-border bg-canaletto-panel px-4 py-3">
    <div className="mb-2 font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-lavender">
      Match {pairing.matchNumber}
    </div>
    <div className="flex items-center justify-between gap-3">
      <SeedSlot seed={pairing.top} align="left" />
      <div className="font-condensed text-lg font-black text-canaletto-magenta">VS</div>
      <SeedSlot seed={pairing.bottom} align="right" />
    </div>
  </div>
);

export const Top16Page = ({ event, run }) => {
  const status = getTop16Status(event);
  const pairings = getTop16Seeding(event);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  return (
    <div>
      <PageHeader eyebrow="Knockout" title="Top 16" subtitle="Seeded strictly from frozen Block A / Block B rank" right={<StatusBadge status={status} />} />

      {(status === 'WAITING_FOR_BOTH' || status === 'WAITING_FOR_A' || status === 'WAITING_FOR_B') && (
        <Panel className="mb-4">
          <div className="text-canaletto-lavender">{WAITING_COPY[status]}</div>
        </Panel>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {pairings.map((p) => (
          <SeedCard key={p.matchNumber} pairing={p} />
        ))}
      </div>

      {status === 'READY' && (
        <ActionButton variant="magenta" onClick={() => run(startTop16)}>
          Start Top 16
        </ActionButton>
      )}
      {status === 'RUNNING' && (
        <div className="rounded border border-canaletto-magenta/60 bg-canaletto-magenta/10 px-4 py-3 text-sm font-semibold text-canaletto-magenta">
          Top 16 is running. Quarterfinal/semifinal/final progression is scoped to the next task.
        </div>
      )}

      {/* Danger Zone — bug fix: previously, once Top 16 started, both
          blocks' Unlock/Reset actions were permanently refused with no way
          back at all (canResetTop16()'s guard checked top16.started, but
          nothing could ever clear it). Resetting Top 16 is safe: no real KO
          bracket/match data exists yet, only this started flag. */}
      {canResetTop16(event).ok && (
        <div className="mt-8 rounded border-2 border-canaletto-magenta/40 bg-canaletto-magenta/5 p-4">
          <div className="mb-1 font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-magenta">Danger Zone</div>
          <div className="mb-3 text-xs text-canaletto-lavender">
            Cancel the Top 16 start so Block A/B can be unlocked or reset again.
          </div>
          <ActionButton variant="danger" onClick={() => setShowResetConfirm(true)}>
            Reset Top 16
          </ActionButton>
          {showResetConfirm && (
            <TypedConfirmModal
              title="Reset Top 16"
              warning="This un-starts Top 16 (no bracket progress exists yet, so nothing else is lost) and re-enables Unlock/Reset on Block A and Block B."
              phrase="RESET TOP16"
              confirmLabel="Reset Top 16"
              onConfirm={() => run(resetTop16)}
              onClose={() => setShowResetConfirm(false)}
            />
          )}
        </div>
      )}
    </div>
  );
};
