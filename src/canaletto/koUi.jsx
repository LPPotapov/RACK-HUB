// KO-specific UI pieces: an operational race-to match card (KoMatchCard) and
// a read-only visual bracket (BracketOverview). Reuses the shared Canaletto
// visual language (ActionButton/PlayerBlock from ui.jsx) rather than
// building a second design system — deliberately separate from ui.jsx's
// MatchRow/MatchSummaryCard, which are built around the fixed-rack Match
// shape and its blank-side-autocomplete score entry, neither of which
// applies to a KO race-to match (docs task item 15).

import { Fragment, useEffect, useState } from 'react';
import { expectedScore } from '../domain/fixedRackBbs.js';
import { KO_RACE_TO, KO_TOP16_SLOT_SIZE, isValidKoScore } from '../application/canalettoKo.js';
import { parseKoScoreField } from './koScoreEntry.js';
import { formatScheduleRange } from './schedule.js';
import { ActionButton, PlayerBlock, formatDelta } from './ui.jsx';

// A single compact, operational KO match card: table, both players (frozen
// GBR + win% from koFrozenMatchDisplay), a required BOTH-sides race-to score
// entry, and Complete/Correct. Never auto-completes a blank side, and the
// submit button stays disabled until the entered pair is a legal race-to-
// `target` result (isValidKoScore — see canalettoKo.js).
export const KoMatchCard = ({
  match, target, disabled, onTableChange, onSubmit,
  tableOptions = [], tableFrozen = false, p1Gbr, p2Gbr, p1WinPct, p2WinPct
}) => {
  const [r1, setR1] = useState(match.done ? String(match.r1) : '');
  const [r2, setR2] = useState(match.done ? String(match.r2) : '');
  const [editing, setEditing] = useState(!match.done);

  useEffect(() => {
    setR1(match.done ? String(match.r1) : '');
    setR2(match.done ? String(match.r2) : '');
    setEditing(!match.done);
  }, [match.matchNumber, match.done, match.r1, match.r2]);

  const n1 = parseKoScoreField(r1);
  const n2 = parseKoScoreField(r2);
  const canSubmit = n1 !== null && n2 !== null && isValidKoScore(n1, n2, target);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(n1, n2);
    setEditing(false);
  };

  return (
    <div className="rounded border border-canaletto-border bg-canaletto-panel2 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <select
          value={match.tbl ?? ''}
          onChange={(e) => onTableChange(e.target.value)}
          disabled={disabled || tableFrozen}
          title={tableFrozen ? 'Tables confirmed — use Edit Tables to change' : undefined}
          className="w-24 rounded border border-canaletto-border bg-canaletto-panel px-1 py-0.5 text-center font-condensed text-xs font-bold text-canaletto-gold disabled:opacity-50"
        >
          <option value="">— Table —</option>
          {match.tbl != null && match.tbl !== '' && !tableOptions.includes(String(match.tbl)) && (
            <option value={match.tbl}>{match.tbl}</option>
          )}
          {tableOptions.map((label) => (
            <option key={label} value={label}>{label}</option>
          ))}
        </select>
        <span className={`font-condensed text-xs font-bold uppercase tracking-widest ${match.done ? 'text-canaletto-gold' : 'text-canaletto-lavender'}`}>
          {match.done ? 'Done' : 'Pending'}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <PlayerBlock name={`${match.p1.seed} ${match.p1.name}`} gbr={p1Gbr} winPct={p1WinPct} align="left" />
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={r1}
              onChange={(e) => setR1(e.target.value)}
              disabled={disabled}
              placeholder="—"
              className="w-11 rounded border border-canaletto-border bg-canaletto-panel px-1 py-0.5 text-center text-canaletto-cream disabled:opacity-50"
            />
            <span className="text-canaletto-lavender">:</span>
            <input
              type="number"
              value={r2}
              onChange={(e) => setR2(e.target.value)}
              disabled={disabled}
              placeholder="—"
              className="w-11 rounded border border-canaletto-border bg-canaletto-panel px-1 py-0.5 text-center text-canaletto-cream disabled:opacity-50"
            />
          </div>
        ) : (
          <div className="text-center font-condensed text-xl font-black text-canaletto-gold">
            {match.r1} : {match.r2}
          </div>
        )}
        <PlayerBlock name={`${match.p2.seed} ${match.p2.name}`} gbr={p2Gbr} winPct={p2WinPct} align="right" />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-canaletto-lavender">Race to {target}</span>
        {editing ? (
          <ActionButton variant="gold" className="px-2 py-1 text-xs" disabled={disabled || !canSubmit} onClick={submit}>
            {match.done ? 'Save' : 'Complete Match'}
          </ActionButton>
        ) : (
          <ActionButton variant="outline" className="px-2 py-1 text-xs" disabled={disabled} onClick={() => setEditing(true)}>
            Correct Result
          </ActionButton>
        )}
      </div>
    </div>
  );
};

// One player's row inside a bracket node — density benchmark is the
// existing Block active-round match card (ui.jsx's MatchRow/PlayerBlock:
// p-2 card padding, text-sm name, text-xs meta, gap-2), NOT the earlier
// two-line-per-player layout, which was substantially taller than a Block
// card. Seed + name + frozen GBR + expected % now share ONE line (name
// truncates first if the row is tight; seed and the GBR/% badge stay put),
// with the score prominent and pinned far right. Score is `text-lg` (bumped
// down from `text-xl` — bracket UI polish pass: the vertical compaction
// pass already tightened line-height, and text-xl then read slightly too
// large; text-lg keeps it clearly more prominent than the text-sm name/
// text-[10px] GBR metadata without materially changing those). `showSeed`
// (Top16 only — see BracketOverview) hides the "A1"/"B8"-style source-seed
// label for QF/SF/Final, where it would misleadingly read as ongoing Block
// A/B seeding rather than normal knockout progression; the seed identity
// itself is untouched data, only this one display is conditional. "–" (em
// dash, not a fabricated 0) until the match is done.
const BracketPlayerRow = ({ slot, expectedPct, score, isWinner, done, showSeed }) => (
  <div className="flex items-center justify-between gap-2 leading-tight">
    <div className="flex min-w-0 flex-1 items-baseline gap-1">
      {showSeed && <span className="shrink-0 font-condensed text-xs font-black text-canaletto-lavender">{slot.seed}</span>}
      <span className={`truncate text-sm font-semibold ${
        isWinner ? 'text-canaletto-gold' : done ? 'text-canaletto-lavender/50 line-through' : 'text-canaletto-cream'
      }`}>
        {slot.name}
      </span>
      <span className="shrink-0 text-[10px] text-canaletto-lavender">
        GBR {Math.round(slot.gbr)}{expectedPct != null && ` · ${Math.round(expectedPct)}%`}
      </span>
    </div>
    <div className={`shrink-0 font-condensed text-lg font-black leading-none tabular-nums ${
      isWinner ? 'text-canaletto-gold' : done ? 'text-canaletto-cream/70' : 'text-canaletto-lavender/40'
    }`}>
      {score}
    </div>
  </div>
);

// Read-only bracket node for a REAL, generated match: ONE compact metadata
// line (race + table + confirmed marker) followed by both player rows —
// everything a viewer needs without referring to the operational cards
// below (docs task item 18), at approximately the Block match card's
// height (card padding `p-2`, no oversized banners/margins — reusing
// Block's own spacing scale rather than a new one). Winner gold, loser
// dimmed/struck once done.
const BracketNode = ({ match, target, tablesConfirmed, gbrConfig, showSeed }) => {
  const p1Winner = match.done && match.winnerPlayerId === match.p1.playerId;
  const p2Winner = match.done && match.winnerPlayerId === match.p2.playerId;
  const p1ExpectedPct = expectedScore(match.p1.gbr, match.p2.gbr, gbrConfig.d) * 100;
  const p2ExpectedPct = expectedScore(match.p2.gbr, match.p1.gbr, gbrConfig.d) * 100;
  return (
    <div className="rounded border border-canaletto-border bg-canaletto-panel p-1.5">
      <div className="mb-0.5 truncate text-[10px] font-bold uppercase leading-tight tracking-wide text-canaletto-lavender">
        <span className="text-canaletto-magenta">RACE {target}</span>
        <span className="mx-1 text-canaletto-lavender/50">·</span>
        <span>TABLE {match.tbl ?? '—'}</span>
        {tablesConfirmed && <span className="ml-1 text-canaletto-gold" title="Tables confirmed">✓</span>}
      </div>
      <div className="space-y-0">
        <BracketPlayerRow slot={match.p1} expectedPct={p1ExpectedPct} score={match.done ? match.r1 : '–'} isWinner={p1Winner} done={match.done} showSeed={showSeed} />
        <BracketPlayerRow slot={match.p2} expectedPct={p2ExpectedPct} score={match.done ? match.r2 : '–'} isWinner={p2Winner} done={match.done} showSeed={showSeed} />
      </div>
    </div>
  );
};

// One participant row inside a PROJECTED (not-yet-generated) bracket slot —
// either a known player name/seed (once the feeding match is done) or a
// muted source label ("WINNER M3" / "Awaiting Block A") — never a generic
// "TBD" (docs task item "SOURCE LABELS"/"no large TBD cards"). `showSeed`
// (Top16 only, see BracketOverview) — QF/SF/Final read as normal knockout
// progression, not ongoing Block A/B seeding.
const BracketProjectedRow = ({ participant, showSeed }) => (
  <div className="truncate text-sm leading-tight">
    {participant.known ? (
      <>
        {showSeed && <><span className="font-condensed text-xs font-black text-canaletto-lavender">{participant.seed}</span>{' '}</>}
        <span className="font-semibold text-canaletto-cream">{participant.name}</span>
      </>
    ) : (
      <span className="text-[11px] font-semibold italic text-canaletto-lavender/50">{participant.sourceLabel}</span>
    )}
  </div>
);

// Lightweight structural slot for a stage that hasn't been generated yet
// (docs task item "FUTURE SLOT DESIGN") — visually lighter/more compact
// than a real BracketNode: dashed border, no table/GBR/win%/score row (none
// of that exists yet for an ungenerated match), just the fixed race target
// (format is known in advance — docs task item "RACE LABELS") and the two
// participant rows, which progressively resolve from source labels to real
// names as earlier matches complete (docs task item "PROGRESSIVE
// POPULATION") — purely a preview; no GBR/expected % is invented here.
const BracketProjectedNode = ({ slot, target, showSeed }) => (
  <div className="rounded border border-dashed border-canaletto-border/60 bg-canaletto-panel/30 px-2 py-1">
    <div className="mb-0.5 text-[9px] font-bold uppercase leading-tight tracking-wide text-canaletto-lavender/60">RACE {target}</div>
    <div className="space-y-0">
      <BracketProjectedRow participant={slot.top} showSeed={showSeed} />
      <BracketProjectedRow participant={slot.bottom} showSeed={showSeed} />
    </div>
  </div>
);

// Dispatches each of a stage's slots to a real BracketNode (generated match)
// or a lighter BracketProjectedNode (preview) — `slots` always has the
// stage's full fixed length (8/4/2/1) from buildBracketProjection(), so no
// separate "how many placeholders" bookkeeping is needed here. `showSeed`
// defaults to false — only Top16's two calls (see BracketOverview) pass
// true; A/B seed labels are source-seeding information specific to Top16
// and would misleadingly read as ongoing Block seeding in QF/SF/Final.
const BracketNodeList = ({ slots, target, tablesConfirmed, gbrConfig, showSeed = false }) => (
  <div className="flex flex-1 flex-col justify-around gap-1">
    {slots.map((slot) => (
      slot.real
        ? <BracketNode key={slot.matchNumber} match={slot.match} target={target} tablesConfirmed={tablesConfirmed} gbrConfig={gbrConfig} showSeed={showSeed} />
        : <BracketProjectedNode key={slot.matchNumber} slot={slot} target={target} showSeed={showSeed} />
    ))}
  </div>
);

const ScheduleLine = ({ entry }) => {
  const text = entry && formatScheduleRange(entry);
  if (!text) return null;
  return <div className="mb-0.5 text-center text-[10px] font-semibold normal-case leading-tight tracking-normal text-canaletto-lavender">{text}</div>;
};

const BracketColumnHeading = ({ title }) => (
  <div className="mb-1 text-center font-condensed text-xs font-bold uppercase leading-tight tracking-widest text-canaletto-lavender">{title}</div>
);

// Widescreen-first 4-column bracket (docs task item 17/25), now ALWAYS
// showing the FULL Top16 -> QF -> SF -> Final tree structure regardless of
// how far the KO has actually progressed (director correction pass —
// "BRACKET STRUCTURE — SHOW THE FULL TREE AT ALL TIMES"). `projection` is
// `getBracketProjection(event)` (see canalettoEvent.js/canalettoKo.js) — a
// PURE DERIVATION, never itself generated/stored KO state; each of the 15
// slots is either a real match or a lightweight preview slot (source label
// or already-known participant). Top16's column is visually grouped into
// SLOT 1 (matches 1-4) / SLOT 2 (matches 5-8) — display grouping only.
// `schedule` (optional) is `event.schedule` — only rendered where an
// estimate is actually configured (docs task item 6). `gbrConfig` (`{d,...}`)
// drives the same expectedScore() calculation koFrozenMatchDisplay() already
// uses for the operational cards — no second formula, and never invented
// for a projected (ungenerated) slot.
export const BracketOverview = ({ projection, ko, schedule, gbrConfig }) => {
  const top16Slot1 = projection.top16.slice(0, KO_TOP16_SLOT_SIZE);
  const top16Slot2 = projection.top16.slice(KO_TOP16_SLOT_SIZE);

  return (
    <div className="mb-3 grid grid-cols-4 gap-4">
      <div className="flex flex-1 flex-col">
        <BracketColumnHeading title="Top 16" />
        <div className="mb-1">
          <div className="mb-0.5 text-center text-[10px] font-bold uppercase leading-tight tracking-widest text-canaletto-magenta">Slot 1</div>
          <ScheduleLine entry={schedule?.top16Slot1} />
          <BracketNodeList slots={top16Slot1} target={KO_RACE_TO.top16} tablesConfirmed={ko.top16?.tablesConfirmed} gbrConfig={gbrConfig} showSeed />
        </div>
        <div>
          <div className="mb-0.5 text-center text-[10px] font-bold uppercase leading-tight tracking-widest text-canaletto-magenta">Slot 2</div>
          <ScheduleLine entry={schedule?.top16Slot2} />
          <BracketNodeList slots={top16Slot2} target={KO_RACE_TO.top16} tablesConfirmed={ko.top16?.tablesConfirmed} gbrConfig={gbrConfig} showSeed />
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        <BracketColumnHeading title="Quarterfinals" />
        <ScheduleLine entry={schedule?.quarterfinals} />
        <BracketNodeList slots={projection.quarterfinals} target={KO_RACE_TO.quarterfinals} tablesConfirmed={ko.quarterfinals?.tablesConfirmed} gbrConfig={gbrConfig} />
      </div>

      <div className="flex flex-1 flex-col">
        <BracketColumnHeading title="Semifinals" />
        <ScheduleLine entry={schedule?.semifinals} />
        <BracketNodeList slots={projection.semifinals} target={KO_RACE_TO.semifinals} tablesConfirmed={ko.semifinals?.tablesConfirmed} gbrConfig={gbrConfig} />
      </div>

      <div className="flex flex-1 flex-col">
        <BracketColumnHeading title="Final" />
        <ScheduleLine entry={schedule?.final} />
        <BracketNodeList slots={projection.final} target={KO_RACE_TO.final} tablesConfirmed={ko.final?.tablesConfirmed} gbrConfig={gbrConfig} />
      </div>
    </div>
  );
};

// Temporary live calibration control (director bugfix pass, items 11-18) —
// belongs specifically to KO Results, deliberately NOT wired into
// canalettoEvent.js's generic settings (easy to remove/hide later, per item
// 17). Local-only `previewPct` state; the caller (Top16Page.jsx) owns it
// and re-derives the whole calibration table from it on every change — no
// Apply button, nothing here ever calls `run()`/mutates the event (item
// 15). Shows CONFIGURED vs TEST/PREVIEW side by side (item 16) so it's
// never ambiguous which one the director is looking at, plus a one-click
// "Reset to Configured Weight" (item 18).
export const KoCalibrationControl = ({ configuredPct, previewPct, onChangePreviewPct, onReset }) => (
  <div className="mb-4 rounded border border-canaletto-magenta/40 bg-canaletto-magenta/5 p-3">
    <div className="mb-2 font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-magenta">KO GBR Weight — Test</div>
    <div className="flex flex-wrap items-center gap-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-canaletto-lavender">Configured KO GBR Weight</div>
        <div className="font-condensed text-lg font-black text-canaletto-cream">{configuredPct}%</div>
      </div>
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-canaletto-lavender">Test / Preview Weight</div>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            className="input w-20 text-right"
            value={previewPct}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              onChangePreviewPct(Math.min(100, Math.max(0, n)));
            }}
          />
          <span className="font-condensed text-sm font-bold text-canaletto-cream">%</span>
        </div>
      </div>
      <ActionButton variant="outline" className="px-3 py-1 text-xs" disabled={previewPct === configuredPct} onClick={onReset}>
        Reset to Configured Weight
      </ActionButton>
      <div className="flex-1 text-xs text-canaletto-lavender">
        Preview only — recalculates the table below via a full sequential replay. Never rewrites stored scores, the bracket, or the actual event setting.
      </div>
    </div>
  </div>
);

// KO Results / GBR calibration table (docs task items 11-14, 25) —
// redesigned this pass for A/B symmetry: Player A and Player B expose the
// SAME metrics (Pre GBR, Win %, Score, Raw Δ, Applied Δ, Post GBR) in the
// SAME order, under grouped column headers, so a director can compare them
// at a glance. One row per GENERATED match across every stage, derived
// fresh (getKoResultsRows() in canalettoEvent.js) and passed in as `rows` —
// this component only formats/renders, it never computes GBR itself.
//
// GBR_INTEGER_RULE (director correction): every visible GBR/ΔGBR value is a
// whole integer, with NO exception — including RAW ΔGBR, which stays full
// float precision internally (canalettoKo.js never rounds it) but is always
// DISPLAYED rounded here. APPLIED ΔGBR/POST GBR are already stored as true
// integers by the engine (see canalettoKo.js's GBR_INTEGER_RULE), so
// rounding them here is a defensive no-op, not where the rounding actually
// happens. `deltaOrDash` reuses ui.jsx's `formatDelta` (already
// integer-only, +N/-N/±0) rather than a second signed-number formatter.
const roundOrDash = (n) => (n == null ? '—' : Math.round(n));
const pctOrDash = (n) => (n == null ? '—' : `${Math.round(n)}%`);
const deltaOrDash = (n) => (n == null ? '—' : formatDelta(n));

// Rebuilt for readability (director bugfix pass, item 7): the previous
// single ultra-wide "Player A metrics | Player B metrics" row was hard to
// scan. TWO ROWS PER MATCH instead — one row per side, sharing the
// Stage/Match/Table/Race cells via rowSpan so they're stated once, not
// duplicated. Columns: Stage / Match / Table / Race / Side / Player /
// Pre GBR / Win % / Score / Raw ΔGBR / Applied ΔGBR / Post GBR. No separate
// Winner column (item 9) — the winning side's row is highlighted gold and
// carries a small "W" badge instead; the score already tells the story.
// `appliedHeaderSuffix` (e.g. "@ 50%") makes it obvious which weight the
// Applied column currently reflects — updates live with the calibration
// preview (docs task item 21).
const KoResultsSideRow = ({ side, isWinner, isFirstOfMatch, groupBorderClass }) => (
  <tr className={`${groupBorderClass} ${isWinner ? 'bg-canaletto-gold/5' : ''}`}>
    <td className={`px-2 py-1 text-center font-condensed text-[10px] font-bold uppercase text-canaletto-lavender ${isFirstOfMatch ? '' : 'border-t-0'}`}>
      {isFirstOfMatch ? 'A' : 'B'}
    </td>
    <td className={`px-2 py-1 font-semibold ${isWinner ? 'text-canaletto-gold' : 'text-canaletto-cream'}`}>
      {side.seed} {side.name}
      {isWinner && <span className="ml-1.5 rounded bg-canaletto-gold px-1 py-0.5 align-middle text-[9px] font-black leading-none text-black">W</span>}
    </td>
    <td className="px-2 py-1 text-right text-canaletto-cream">{roundOrDash(side.preGbr)}</td>
    <td className="px-2 py-1 text-right text-canaletto-lavender">{pctOrDash(side.expectedPct)}</td>
    <td className="px-2 py-1 text-center font-condensed font-black text-canaletto-gold">{side.score ?? '—'}</td>
    <td className="px-2 py-1 text-right text-canaletto-cream">{deltaOrDash(side.rawDelta)}</td>
    <td className="px-2 py-1 text-right font-bold text-canaletto-cream">{deltaOrDash(side.appliedDelta)}</td>
    <td className="px-2 py-1 text-right text-canaletto-cream">{roundOrDash(side.postGbr)}</td>
  </tr>
);

export const KoResultsTable = ({ rows, appliedHeaderSuffix }) => (
  <div className="overflow-x-auto rounded border border-canaletto-border bg-canaletto-panel">
    <table className="w-full min-w-[760px] border-collapse text-left text-xs">
      <thead>
        <tr className="border-b border-canaletto-border text-[10px] font-bold uppercase tracking-widest text-canaletto-lavender">
          <th className="px-2 py-1.5">Side</th>
          <th className="px-2 py-1.5">Player</th>
          <th className="px-2 py-1.5 text-right">Pre GBR</th>
          <th className="px-2 py-1.5 text-right">Win %</th>
          <th className="px-2 py-1.5 text-center">Score</th>
          <th className="px-2 py-1.5 text-right">Raw ΔGBR</th>
          <th className="px-2 py-1.5 text-right">Applied ΔGBR{appliedHeaderSuffix && <span className="ml-1 normal-case text-canaletto-gold">{appliedHeaderSuffix}</span>}</th>
          <th className="px-2 py-1.5 text-right">Post GBR</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={8} className="px-2 py-6 text-center text-canaletto-lavender">No KO matches generated yet.</td></tr>
        )}
        {rows.map((r) => (
          <Fragment key={`${r.stage}-${r.matchNumber}`}>
            <tr className="border-t-2 border-canaletto-border bg-canaletto-panel2/40 text-[10px] font-bold uppercase tracking-widest text-canaletto-lavender">
              <td colSpan={8} className="px-2 py-1">
                {r.stageLabel} <span className="text-canaletto-lavender/60">·</span> Match {r.matchNumber}
                <span className="text-canaletto-lavender/60"> · </span>Table {r.tbl ?? '—'}
                <span className="text-canaletto-lavender/60"> · </span>Race {r.target}
              </td>
            </tr>
            <KoResultsSideRow side={r.playerA} isWinner={r.winnerSeed === r.playerA.seed} isFirstOfMatch groupBorderClass="border-t border-canaletto-border/60" />
            <KoResultsSideRow side={r.playerB} isWinner={r.winnerSeed === r.playerB.seed} isFirstOfMatch={false} groupBorderClass="" />
          </Fragment>
        ))}
      </tbody>
    </table>
  </div>
);

// KO Player Summary (docs task item 29) — one row per player who has
// appeared in any generated KO match. `rows` is getKoPlayerSummary(event)'s
// output, already sorted by totalDeltaGbr descending (biggest net APPLIED
// GBR gain first — the tournament-winner-inflation view this exists for).
export const KoPlayerSummaryTable = ({ rows }) => (
  <div className="overflow-x-auto rounded border border-canaletto-border bg-canaletto-panel">
    <table className="w-full min-w-[640px] border-collapse text-left text-xs">
      <thead>
        <tr className="border-b border-canaletto-border text-[10px] font-bold uppercase tracking-widest text-canaletto-lavender">
          <th className="px-2 py-1.5">Player</th>
          <th className="px-2 py-1.5 text-right">KO Matches</th>
          <th className="px-2 py-1.5 text-right">KO Wins</th>
          <th className="px-2 py-1.5 text-right">Start KO GBR</th>
          <th className="px-2 py-1.5 text-right">Current / Final GBR</th>
          <th className="px-2 py-1.5 text-right">Total KO ΔGBR</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.playerId} className="border-b border-canaletto-border/60">
            <td className="px-2 py-1 font-semibold text-canaletto-cream">{p.name}</td>
            <td className="px-2 py-1 text-right text-canaletto-cream">{p.koMatches}</td>
            <td className="px-2 py-1 text-right text-canaletto-cream">{p.koWins}</td>
            <td className="px-2 py-1 text-right text-canaletto-cream">{roundOrDash(p.startGbr)}</td>
            <td className="px-2 py-1 text-right text-canaletto-cream">{roundOrDash(p.currentGbr)}</td>
            <td className="px-2 py-1 text-right font-bold text-canaletto-gold">{deltaOrDash(p.totalDeltaGbr)}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={6} className="px-2 py-6 text-center text-canaletto-lavender">No KO matches generated yet.</td></tr>
        )}
      </tbody>
    </table>
  </div>
);

// Champion total KO ΔGBR (docs task item 30) — the single most important
// calibration number once the event is complete: how much APPLIED GBR the
// champion accumulated across their whole four-match run, derived from
// actual match history (getKoChampionSummary(event) in canalettoEvent.js).
export const ChampionKoSummary = ({ summary }) => {
  if (!summary) return null;
  return (
    <div className="mb-4 rounded border border-canaletto-gold/50 bg-canaletto-gold/5 p-3">
      <div className="mb-1 font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-gold">Champion — Total KO ΔGBR</div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-canaletto-cream">
        <span className="font-semibold">{summary.name}</span>
        <span>GBR entering Top16: <span className="font-bold">{roundOrDash(summary.startGbr)}</span></span>
        <span>GBR after Final: <span className="font-bold">{roundOrDash(summary.currentGbr)}</span></span>
        <span>Total KO ΔGBR: <span className="font-bold text-canaletto-gold">{deltaOrDash(summary.totalDeltaGbr)}</span></span>
      </div>
    </div>
  );
};

// Champion/completion banner (docs task item 27) — shown once the Final is
// complete, above the still-fully-visible bracket.
export const ChampionBanner = ({ champion }) => {
  if (!champion) return null;
  return (
    <div className="mb-6 rounded border-2 border-canaletto-gold bg-canaletto-gold/10 p-6 text-center">
      <div className="font-condensed text-xs font-bold uppercase tracking-[0.3em] text-canaletto-gold">Canaletto Cup 2026 Champion</div>
      <div className="mt-2 font-condensed text-4xl font-black uppercase text-canaletto-cream">{champion.name}</div>
      <div className="mt-2 text-sm font-semibold text-canaletto-lavender">
        Final {champion.r1}–{champion.r2} · Runner-up {champion.runnerUpName}
      </div>
    </div>
  );
};
