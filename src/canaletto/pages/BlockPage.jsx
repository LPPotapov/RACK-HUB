import { useState } from 'react';
import {
  addPendingPlayerToBlock,
  advanceBlockRound,
  applyBlockManualPairings,
  assignBlockMatchTable,
  canLockBlock,
  confirmBlockRoundTables,
  editBlockRoundTables,
  getBlockResultsRows,
  getBlockStatus,
  getRoundStandings,
  isRoundTablesConfirmed,
  lockBlock,
  markBlockPlayerMissing,
  recordBlockMatchResult,
  undoBlockPlayerMissing
} from '../../application/canalettoEvent.js';
import { splitForTwoColumnDisplay } from '../layout.js';
import { frozenMatchDisplay } from '../matchDisplay.js';
import { formatScheduleRange } from '../schedule.js';
import { AddPlayerModal } from '../AddPlayerModal.jsx';
import { ManualPairingModal } from '../ManualPairingModal.jsx';
import { DangerZone } from '../DangerZone.jsx';
import { ActionButton, CompactStatusBar, MatchRow, MatchSummaryCard, PageHeader, Panel, StandingsTable, StatusBadge } from '../ui.jsx';

// Match card grid: 4 columns on the normal widescreen layout. `lg` (1024px)
// rather than `xl` so this holds at the app's actual ~1180px minimum width;
// for the intended 16-match/32-player round this renders as 4 columns x 4
// rows.
const MATCH_GRID_CLASSES = 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4';

// ONE continuous ranking, displayed in two visual columns (1-N/2 | N/2+1-N)
// — never independently sorted. Shared by Block Results and each round's
// All Rounds standings snapshot.
const TwoColumnStandings = ({ rows, qualificationThreshold }) => {
  const [left, right] = splitForTwoColumnDisplay(rows);
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <StandingsTable players={left} qualificationThreshold={qualificationThreshold} />
      <StandingsTable players={right} qualificationThreshold={qualificationThreshold} />
    </div>
  );
};

const RoundView = ({ event, run, block, roundNumber, onAdvanced }) => {
  const tournament = event[`block${block}`].tournament;
  const matches = tournament.rounds[roundNumber] || [];
  const locked = !!event[`block${block}Lock`];
  const isCurrentRound = roundNumber === tournament.currentRound;
  const completedCount = matches.filter((m) => m.done || m.cancelled).length;
  const allComplete = matches.length > 0 && completedCount === matches.length;
  const canAdvance = isCurrentRound && allComplete && tournament.currentRound < tournament.totalRounds && !locked;
  const canManageCurrentRound = isCurrentRound && !locked;

  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [showEditPairings, setShowEditPairings] = useState(false);
  const openMatches = matches.filter((m) => !m.done && !m.cancelled && !m.bye);
  const tableOptions = event.tables.map((t) => t.label);
  const tablesConfirmed = isRoundTablesConfirmed(event, block, roundNumber);

  return (
    <div>
      <CompactStatusBar
        items={[
          { label: 'Round', value: roundNumber, total: tournament.totalRounds },
          { label: 'Matches', value: completedCount, total: matches.length },
          { label: 'Tables', value: new Set(matches.filter((m) => !m.bye).map((m) => m.tbl)).size },
          { label: 'Fixed Racks', value: tournament.config.max_games }
        ]}
      />

      {!locked && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {canManageCurrentRound && (
            <>
              <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={() => setShowAddPlayer(true)}>
                Add Player
              </ActionButton>
              <ActionButton
                variant="outline"
                className="px-3 py-1 text-xs"
                disabled={openMatches.length === 0}
                onClick={() => setShowEditPairings(true)}
              >
                Edit Pairings
              </ActionButton>
            </>
          )}
          {tablesConfirmed ? (
            <>
              <span className="rounded border border-canaletto-gold/50 bg-canaletto-gold/10 px-3 py-1 font-condensed text-xs font-bold uppercase tracking-wider text-canaletto-gold">
                Tables Confirmed ✓
              </span>
              <ActionButton
                variant="outline"
                className="px-3 py-1 text-xs"
                onClick={() => run(editBlockRoundTables, block, roundNumber)}
              >
                Edit Tables
              </ActionButton>
            </>
          ) : (
            <ActionButton
              variant="gold"
              className="px-3 py-1 text-xs"
              onClick={() => run(confirmBlockRoundTables, block, roundNumber)}
            >
              Confirm Tables
            </ActionButton>
          )}
        </div>
      )}

      <div className={MATCH_GRID_CLASSES}>
        {matches.map((m) => (
          <MatchRow
            key={m.id}
            match={m}
            disabled={locked}
            roundNumber={roundNumber}
            tableOptions={tableOptions}
            tableFrozen={tablesConfirmed}
            onTableChange={(table) => run(assignBlockMatchTable, block, { roundNumber, matchId: m.id, table })}
            onSubmit={(r1, r2) => run(recordBlockMatchResult, block, { roundNumber, matchId: m.id, r1, r2 })}
            onMarkMissing={canManageCurrentRound ? (missingPlayerId) => run(markBlockPlayerMissing, block, { matchId: m.id, missingPlayerId }) : undefined}
            onUndoMissing={canManageCurrentRound ? () => run(undoBlockPlayerMissing, block, { matchId: m.id }) : undefined}
            {...(!m.bye ? frozenMatchDisplay(m, tournament.config) : {})}
          />
        ))}
        {matches.length === 0 && <div className="py-6 text-center text-canaletto-lavender lg:col-span-4">No matches generated yet.</div>}
      </div>

      {isCurrentRound && (
        <div className="mt-4 flex items-center gap-3">
          {canAdvance && (
            <ActionButton
              variant="gold"
              onClick={() => {
                const ok = run(advanceBlockRound, block);
                if (ok) onAdvanced(roundNumber + 1);
              }}
            >
              Next Round
            </ActionButton>
          )}
          {!canAdvance && !locked && tournament.currentRound >= tournament.totalRounds && allComplete && (
            <div className="text-sm font-semibold text-canaletto-gold">
              Final round complete — go to Block Results to lock Block {block}.
            </div>
          )}
          {!allComplete && <div className="text-sm text-canaletto-lavender">Complete every match before advancing.</div>}
        </div>
      )}

      {showAddPlayer && (
        <AddPlayerModal
          nextRound={tournament.currentRound + 1}
          onConfirm={(player) => {
            let nextId = 1;
            [...tournament.roster, ...tournament.pendingPlayers, ...tournament.players].forEach((p) => {
              if (typeof p.id === 'number' && p.id >= nextId) nextId = p.id + 1;
            });
            run(addPendingPlayerToBlock, block, { id: nextId, name: player.name, elo: player.elo });
          }}
          onClose={() => setShowAddPlayer(false)}
        />
      )}
      {showEditPairings && (
        <ManualPairingModal
          openMatches={openMatches}
          roundNumber={roundNumber}
          onApply={(pairings) => run(applyBlockManualPairings, block, { pairings })}
          onClose={() => setShowEditPairings(false)}
        />
      )}
    </div>
  );
};

// Sequential by round (director correction pass, item 3): for EVERY round,
// in tournament order — heading, that round's 4-column match cards, THEN
// that SAME round's two-column standings snapshot — before moving to the
// next round. Never groups multiple rounds' standings together. Standings
// are derived fresh via getRoundStandings() on every render, so a later
// correction to an earlier round is reflected automatically without
// touching any stored pairing.
const AllRoundsView = ({ event, block }) => {
  const tournament = event[`block${block}`].tournament;
  const rounds = Array.from({ length: tournament.currentRound }, (_, i) => i + 1);
  return (
    <div className="space-y-8">
      {rounds.map((r) => (
        <div key={r}>
          <div className="mb-3 font-condensed text-2xl font-black uppercase tracking-tight text-canaletto-cream">Round {r}</div>
          <div className={MATCH_GRID_CLASSES}>
            {(tournament.rounds[r] || []).map((m) => (
              <MatchSummaryCard
                key={m.id}
                match={m}
                tablesConfirmed={isRoundTablesConfirmed(event, block, r)}
                {...(!m.bye ? frozenMatchDisplay(m, tournament.config) : {})}
              />
            ))}
          </div>
          <div className="mt-3">
            <div className="mb-2 font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-lavender">
              Standings after Round {r}
            </div>
            <TwoColumnStandings rows={getRoundStandings(event, block, r)} qualificationThreshold={event.settings.qualificationThreshold} />
          </div>
        </div>
      ))}
    </div>
  );
};

// Block Results: ONE continuous authoritative ranking, displayed as ranks
// 1-N/2 | N/2+1-N side by side (director correction pass, item 1) — never
// independently sorted. Post-lock, rows for the frozen qualifiers are
// flagged by getBlockResultsRows() and rendered magenta by StandingsTable —
// based on the block's frozen qualifier identities, not a freshly
// recalculated Top-N.
const ResultsView = ({ event, run, block }) => {
  const status = getBlockStatus(event, block);
  const lockData = event[`block${block}Lock`];
  const rows = getBlockResultsRows(event, block);
  const eligibility = canLockBlock(event, block);
  const [confirming, setConfirming] = useState(false);

  return (
    <div>
      <Panel title="Standings" compact right={<StatusBadge status={status} />}>
        <div className="mb-1 text-[11px] text-canaletto-lavender">Sort order: Match Points, then Rack Diff, then PERF/GBR.</div>
        <TwoColumnStandings rows={rows} qualificationThreshold={event.settings.qualificationThreshold} />
      </Panel>

      <div className="mt-3">
        {status === 'LOCKED' ? (
          <div className="rounded border border-canaletto-magenta/50 bg-canaletto-magenta/10 px-4 py-3 text-sm font-semibold text-canaletto-magenta">
            Block {block} is locked. Top {lockData.qualifiers.length} qualifiers ({lockData.qualifiers[0]?.seed}–{lockData.qualifiers[lockData.qualifiers.length - 1]?.seed}) are frozen for Top 16 seeding.
          </div>
        ) : confirming ? (
          <div className="rounded border border-canaletto-magenta/60 bg-canaletto-panel2 p-4">
            <div className="mb-3 font-semibold text-canaletto-cream">
              Locking Block {block} freezes the Top {event.settings.qualificationThreshold} standings permanently. No further edits, corrections, or rounds will be possible. Continue?
            </div>
            <div className="flex gap-2">
              <ActionButton variant="magenta" onClick={() => { run(lockBlock, block); setConfirming(false); }}>
                Confirm Lock
              </ActionButton>
              <ActionButton variant="outline" onClick={() => setConfirming(false)}>Cancel</ActionButton>
            </div>
          </div>
        ) : (
          <ActionButton variant="magenta" disabled={!eligibility.ok} onClick={() => setConfirming(true)}>
            Finish &amp; Lock Block {block}
          </ActionButton>
        )}
        {!eligibility.ok && status !== 'LOCKED' && (
          <div className="mt-2 text-xs text-canaletto-lavender">{eligibility.reason}</div>
        )}
      </div>
    </div>
  );
};

export const BlockPage = ({ event, run, block }) => {
  const tournament = event[`block${block}`].tournament;
  const status = getBlockStatus(event, block);
  const [subView, setSubView] = useState('round');
  const [viewingRound, setViewingRound] = useState(tournament.currentRound || 1);
  // Compact estimated-schedule readout (director correction pass, item
  // 3/32) — planning metadata only, never a large banner, and never read by
  // any operation gate. Same formatScheduleRange() helper KO uses, so the
  // format (European DD.MM.YYYY · 24h HH:MM) is identical everywhere.
  const scheduleText = formatScheduleRange(event.schedule?.[`block${block}`]);

  if (status === 'NOT_STARTED') {
    return (
      <div>
        <PageHeader eyebrow={`Block ${block}`} title={`Block ${block}`} />
        {scheduleText && <div className="mb-3 text-xs font-semibold text-canaletto-lavender">{scheduleText}</div>}
        <Panel>
          <div className="text-canaletto-lavender">
            Block {block} has not started yet. Register players and start it from the Players page.
          </div>
        </Panel>
      </div>
    );
  }

  const roundTabs = Array.from({ length: tournament.currentRound }, (_, i) => i + 1);

  return (
    <div>
      <PageHeader
        eyebrow={`Block ${block}`}
        title={subView === 'round' ? `Round ${viewingRound} / ${tournament.totalRounds}` : subView === 'all' ? 'All Rounds' : 'Block Results'}
        subtitle={`${tournament.config.max_games} FIXED RACKS`}
        right={<StatusBadge status={status} />}
      />
      {scheduleText && <div className="mb-3 -mt-2 text-xs font-semibold text-canaletto-lavender">{scheduleText}</div>}

      <div className="mb-3 flex flex-wrap gap-2 border-b border-canaletto-border pb-2">
        {roundTabs.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => { setSubView('round'); setViewingRound(r); }}
            className={`rounded border px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-wider ${
              subView === 'round' && viewingRound === r
                ? 'border-canaletto-gold bg-canaletto-gold text-black'
                : 'border-canaletto-border text-canaletto-lavender hover:text-canaletto-cream'
            }`}
          >
            Round {r}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSubView('all')}
          className={`rounded border px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-wider ${
            subView === 'all' ? 'border-canaletto-gold bg-canaletto-gold text-black' : 'border-canaletto-border text-canaletto-lavender hover:text-canaletto-cream'
          }`}
        >
          All Rounds
        </button>
        <button
          type="button"
          onClick={() => setSubView('results')}
          className={`rounded border px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-wider ${
            subView === 'results' ? 'border-canaletto-magenta bg-canaletto-magenta text-white' : 'border-canaletto-border text-canaletto-lavender hover:text-canaletto-cream'
          }`}
        >
          Block Results
        </button>
      </div>

      {subView === 'round' && (
        <RoundView event={event} run={run} block={block} roundNumber={viewingRound} onAdvanced={setViewingRound} />
      )}
      {subView === 'all' && <AllRoundsView event={event} block={block} />}
      {subView === 'results' && <ResultsView event={event} run={run} block={block} />}

      <DangerZone event={event} run={run} block={block} status={status} currentRound={tournament.currentRound} />
    </div>
  );
};
