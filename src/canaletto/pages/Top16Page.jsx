import { useState } from 'react';
import {
  assignKoTable,
  canCorrectKoStage,
  canResetKoStage,
  canStartKoStage,
  confirmKoTables,
  editKoTables,
  getBracketProjection,
  getCurrentKoStage,
  getKoChampion,
  getKoGbrWeight,
  getKoRatingSimulation,
  getTop16Status,
  recordKoResult,
  resetKoStage,
  startKoStage
} from '../../application/canalettoEvent.js';
import { KO_RACE_TO, KO_STAGE_LABEL, KO_STAGE_ORDER, KO_TOP16_SLOT_SIZE, isKoStageComplete, summarizeKoPlayersFromRows } from '../../application/canalettoKo.js';
import { koFrozenMatchDisplay } from '../koMatchDisplay.js';
import { formatScheduleRange } from '../schedule.js';
import { BracketOverview, ChampionBanner, ChampionKoSummary, KoCalibrationControl, KoMatchCard, KoPlayerSummaryTable, KoResultsTable } from '../koUi.jsx';
import { ActionButton, PageHeader, Panel, StatusBadge } from '../ui.jsx';
import { TypedConfirmModal } from '../TypedConfirmModal.jsx';

// Maps a KO stage to its schedule key(s) (docs task item 5/6) — Top16 has
// two (one per operational slot), every other stage has exactly one.
const SCHEDULE_KEY_FOR_STAGE = { quarterfinals: 'quarterfinals', semifinals: 'semifinals', final: 'final' };

const WAITING_COPY = {
  WAITING_FOR_BOTH: 'Waiting for both blocks to be locked.',
  WAITING_FOR_A: 'Block B is locked. Waiting for Block A.',
  WAITING_FOR_B: 'Block A is locked. Waiting for Block B.'
};

// Exact typed-confirmation phrases (docs task item 18) — deliberately NOT
// derived from KO_STAGE_LABEL (which reads "Top 16" with a space); these are
// the exact strings the director must type.
const RESET_PHRASE = {
  top16: 'RESET TOP16',
  quarterfinals: 'RESET QUARTERFINALS',
  semifinals: 'RESET SEMIFINALS',
  final: 'RESET FINAL'
};

// One operational match grid, reused for QF/SF/Final and for each Top16
// slot below — table assignment + race-to score entry (docs task item 26,
// item 19: keep frozen GBR/win%/score controls/table dropdown/Confirm-Edit
// intact).
const MatchGrid = ({ matches, target, correctable, tableOptions, tablesConfirmed, gbrConfig, run, stage }) => (
  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
    {matches.map((m) => (
      <KoMatchCard
        key={m.matchNumber}
        match={m}
        target={target}
        disabled={!correctable}
        tableOptions={tableOptions}
        tableFrozen={tablesConfirmed}
        onTableChange={(table) => run(assignKoTable, stage, { matchNumber: m.matchNumber, table })}
        onSubmit={(r1, r2) => run(recordKoResult, stage, { matchNumber: m.matchNumber, r1, r2 })}
        {...koFrozenMatchDisplay(m, gbrConfig)}
      />
    ))}
  </div>
);

// Operational panel for the CURRENT active KO stage (the furthest-advanced
// started stage) — table assignment + race-to score entry (docs task item
// 26). The read-only BracketOverview above handles the progression view;
// this is where the director actually operates matches.
//
// Top16 slots (docs task item 1/3/20): Top16 remains ONE KoStage/one
// Confirm-Tables flag — the "simplest acceptable" model from item 20 — but
// its 8 matches are displayed as two explicit SLOT 1 (1-4) / SLOT 2 (5-8)
// groups so the director has a clear operational boundary between the two
// four-match timeslots, without a second seeding step or second bracket
// round. QF never starts until ALL 8 matches (both slots) are done —
// unaffected by this display grouping, since isKoStageComplete() already
// checks every match in the stage.
const StageOperationPanel = ({ event, run, stage, gbrConfig }) => {
  const stageState = event.ko[stage];
  const target = KO_RACE_TO[stage];
  const tableOptions = event.tables.map((t) => t.label);
  const tablesConfirmed = stageState.tablesConfirmed;
  const correctable = canCorrectKoStage(event, stage);
  const complete = isKoStageComplete(stageState);
  const stageIdx = KO_STAGE_ORDER.indexOf(stage);
  const nextStage = KO_STAGE_ORDER[stageIdx + 1];
  const nextEligibility = nextStage ? canStartKoStage(event, nextStage) : null;
  const scheduleKey = SCHEDULE_KEY_FOR_STAGE[stage];
  const scheduleText = scheduleKey ? formatScheduleRange(event.schedule[scheduleKey]) : null;

  const tableConfirmControls = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {tablesConfirmed ? (
        <>
          <span className="rounded border border-canaletto-gold/50 bg-canaletto-gold/10 px-3 py-1 font-condensed text-xs font-bold uppercase tracking-wider text-canaletto-gold">
            Tables Confirmed ✓
          </span>
          <ActionButton variant="outline" className="px-3 py-1 text-xs" disabled={!correctable} onClick={() => run(editKoTables, stage)}>
            Edit Tables
          </ActionButton>
        </>
      ) : (
        <ActionButton variant="gold" className="px-3 py-1 text-xs" disabled={!correctable} onClick={() => run(confirmKoTables, stage)}>
          Confirm Tables
        </ActionButton>
      )}
    </div>
  );

  return (
    <Panel
      title={`${KO_STAGE_LABEL[stage]} — Race to ${target}`}
      accent="magenta"
      right={<StatusBadge status={complete ? 'COMPLETE' : 'RUNNING'} />}
    >
      {scheduleText && <div className="mb-3 text-xs font-semibold text-canaletto-lavender">{scheduleText}</div>}
      {!correctable && (
        <div className="mb-3 text-xs font-semibold text-canaletto-magenta">
          {KO_STAGE_LABEL[stage]} is locked — {KO_STAGE_LABEL[nextStage]} has already started. Use Reset Current KO Stage to walk back.
        </div>
      )}

      {stage === 'top16' ? (
        <>
          {tableConfirmControls}
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="font-condensed text-sm font-black uppercase tracking-wide text-canaletto-gold">Top 16 — Slot 1</div>
              {formatScheduleRange(event.schedule.top16Slot1) && (
                <div className="text-xs font-semibold text-canaletto-lavender">{formatScheduleRange(event.schedule.top16Slot1)}</div>
              )}
            </div>
            <MatchGrid
              matches={stageState.matches.slice(0, KO_TOP16_SLOT_SIZE)}
              target={target}
              correctable={correctable}
              tableOptions={tableOptions}
              tablesConfirmed={tablesConfirmed}
              gbrConfig={gbrConfig}
              run={run}
              stage={stage}
            />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="font-condensed text-sm font-black uppercase tracking-wide text-canaletto-gold">Top 16 — Slot 2</div>
              {formatScheduleRange(event.schedule.top16Slot2) && (
                <div className="text-xs font-semibold text-canaletto-lavender">{formatScheduleRange(event.schedule.top16Slot2)}</div>
              )}
            </div>
            <MatchGrid
              matches={stageState.matches.slice(KO_TOP16_SLOT_SIZE)}
              target={target}
              correctable={correctable}
              tableOptions={tableOptions}
              tablesConfirmed={tablesConfirmed}
              gbrConfig={gbrConfig}
              run={run}
              stage={stage}
            />
          </div>
        </>
      ) : (
        <>
          {tableConfirmControls}
          <MatchGrid
            matches={stageState.matches}
            target={target}
            correctable={correctable}
            tableOptions={tableOptions}
            tablesConfirmed={tablesConfirmed}
            gbrConfig={gbrConfig}
            run={run}
            stage={stage}
          />
        </>
      )}
      {complete && nextStage && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded border border-canaletto-gold/50 bg-canaletto-gold/10 px-4 py-3">
          <div className="flex-1 font-condensed text-sm font-bold uppercase tracking-wide text-canaletto-gold">
            {KO_STAGE_LABEL[stage].toUpperCase()} COMPLETE
          </div>
          <ActionButton variant="gold" disabled={!nextEligibility.ok} onClick={() => run(startKoStage, nextStage)}>
            Start {KO_STAGE_LABEL[nextStage]}
          </ActionButton>
        </div>
      )}
      {complete && !nextStage && (
        <div className="mt-4 rounded border border-canaletto-gold/50 bg-canaletto-gold/10 px-4 py-3 text-center font-condensed text-sm font-bold uppercase tracking-wide text-canaletto-gold">
          Final Complete
        </div>
      )}
    </Panel>
  );
};

export const Top16Page = ({ event, run }) => {
  const status = getTop16Status(event);
  const currentStage = getCurrentKoStage(event);
  const champion = getKoChampion(event);
  const gbrConfig = event.blockA.tournament.config;
  const projection = getBracketProjection(event);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [subView, setSubView] = useState('bracket'); // 'bracket' | 'results'
  // KO Results calibration preview (director bugfix pass, items 11-18):
  // LOCAL-ONLY state, initialized from the configured event weight but
  // never written back to it — changing this only re-derives the table
  // below via a pure replay (getKoRatingSimulation), never touches `event`.
  const configuredWeightPct = Math.round(getKoGbrWeight(event) * 100);
  const [previewPct, setPreviewPct] = useState(configuredWeightPct);

  return (
    <div>
      <PageHeader
        eyebrow="Knockout"
        title="Canaletto Cup — Bracket"
        subtitle={champion ? 'Complete' : currentStage ? `Operating ${KO_STAGE_LABEL[currentStage]}` : 'Seeded strictly from frozen Block A / Block B rank'}
        right={<StatusBadge status={champion ? 'COMPLETE' : currentStage ? 'RUNNING' : status} />}
      />

      <ChampionBanner champion={champion} />

      {/* Pre-KO: the full bracket tree is ALREADY visible below (via
          getBracketProjection()'s Top16 preview slots) — this banner only
          adds the waiting/start-eligibility context above it (docs task
          "BRACKET STRUCTURE — SHOW THE FULL TREE AT ALL TIMES"). */}
      {!currentStage && (status === 'WAITING_FOR_BOTH' || status === 'WAITING_FOR_A' || status === 'WAITING_FOR_B') && (
        <Panel className="mb-4">
          <div className="text-canaletto-lavender">{WAITING_COPY[status]}</div>
        </Panel>
      )}
      {!currentStage && status === 'READY' && (
        <ActionButton variant="magenta" className="mb-4" onClick={() => run(startKoStage, 'top16')}>
          Start Top 16
        </ActionButton>
      )}

      {currentStage && (
        <div className="mb-4 flex flex-wrap gap-2 border-b border-canaletto-border pb-2">
          <button
            type="button"
            onClick={() => setSubView('bracket')}
            className={`rounded border px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-wider ${
              subView === 'bracket' ? 'border-canaletto-gold bg-canaletto-gold text-black' : 'border-canaletto-border text-canaletto-lavender hover:text-canaletto-cream'
            }`}
          >
            Bracket
          </button>
          <button
            type="button"
            onClick={() => setSubView('results')}
            className={`rounded border px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-wider ${
              subView === 'results' ? 'border-canaletto-magenta bg-canaletto-magenta text-white' : 'border-canaletto-border text-canaletto-lavender hover:text-canaletto-cream'
            }`}
          >
            KO Results
          </button>
        </div>
      )}

      {currentStage && subView === 'results' && (() => {
        // Sequential replay at the PREVIEW weight (docs task item 13/14) —
        // NOT a per-row multiply of stored deltas. At previewPct ===
        // configuredWeightPct this reproduces the authoritative stored
        // values exactly (tested); away from it, every downstream PRE
        // GBR/expected %/RAW delta cascades correctly too.
        const previewRows = getKoRatingSimulation(event, previewPct / 100);
        const previewSummary = summarizeKoPlayersFromRows(previewRows);
        const previewChampionSummary = champion ? previewSummary.find((p) => p.playerId === champion.playerId) : null;
        return (
          <div className="mb-6 space-y-6">
            <KoCalibrationControl
              configuredPct={configuredWeightPct}
              previewPct={previewPct}
              onChangePreviewPct={setPreviewPct}
              onReset={() => setPreviewPct(configuredWeightPct)}
            />
            {champion && (
              <ChampionKoSummary summary={champion && previewChampionSummary ? { ...champion, ...previewChampionSummary } : null} />
            )}
            <div>
              <div className="mb-2 text-xs text-canaletto-lavender">
                Every generated Top16/Quarterfinal/Semifinal/Final matchup, for tournament direction and GBR calibration.
                Raw ΔGBR is the unweighted BBS change; Applied ΔGBR is what actually moves a player's GBR into their next KO match, at the weight shown above.
              </div>
              <KoResultsTable rows={previewRows} appliedHeaderSuffix={`@ ${previewPct}%`} />
            </div>
            <div>
              <div className="mb-2 font-condensed text-sm font-black uppercase tracking-wide text-canaletto-cream">KO Player Summary</div>
              <KoPlayerSummaryTable rows={previewSummary} />
            </div>
          </div>
        );
      })()}

      {(!currentStage || subView === 'bracket') && (
        <>
          <BracketOverview projection={projection} ko={event.ko} schedule={event.schedule} gbrConfig={gbrConfig} />
          {currentStage && <StageOperationPanel event={event} run={run} stage={currentStage} gbrConfig={gbrConfig} />}
        </>
      )}

      {/* KO Danger Zone (docs task item 17/18): walks the bracket back
          exactly one stage, typed confirmation required. */}
      {currentStage && canResetKoStage(event).ok && (
        <div className="mt-8 rounded border-2 border-canaletto-magenta/40 bg-canaletto-magenta/5 p-4">
          <div className="mb-1 font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-magenta">Danger Zone</div>
          <div className="mb-3 text-xs text-canaletto-lavender">
            Reset {KO_STAGE_LABEL[currentStage]} and walk the bracket back one stage.
          </div>
          <ActionButton variant="danger" onClick={() => setShowResetConfirm(true)}>
            Reset {KO_STAGE_LABEL[currentStage]}
          </ActionButton>
          {showResetConfirm && (
            <TypedConfirmModal
              title={`Reset ${KO_STAGE_LABEL[currentStage]}`}
              warning={
                currentStage === 'top16'
                  ? 'This deletes every Top 16 match/result and re-enables Unlock/Reset on Block A and Block B. Block results and qualifiers are untouched.'
                  : `This deletes ${KO_STAGE_LABEL[currentStage]}'s matches/results and reopens the completed ${KO_STAGE_LABEL[KO_STAGE_ORDER[KO_STAGE_ORDER.indexOf(currentStage) - 1]]} for correction.`
              }
              phrase={RESET_PHRASE[currentStage]}
              confirmLabel={`Reset ${KO_STAGE_LABEL[currentStage]}`}
              onConfirm={() => run(resetKoStage)}
              onClose={() => setShowResetConfirm(false)}
            />
          )}
        </div>
      )}
    </div>
  );
};
