// Shared visual components for the Canaletto UI. Deliberately minimal —
// just enough pieces to keep every Canaletto page visually consistent
// (dark plum surfaces, gold/magenta accents, condensed uppercase headings),
// not a general design system.

import { useEffect, useState } from 'react';
import { resolveScoreField } from './scoreEntry.js';

export const PageHeader = ({ eyebrow, title, subtitle, right }) => (
  <div className="mb-4 flex flex-wrap items-start justify-between gap-4 border-b border-canaletto-border pb-3">
    <div>
      {eyebrow && (
        <div className="mb-1 font-condensed text-xs font-bold uppercase tracking-[0.2em] text-canaletto-magenta">
          {eyebrow}
        </div>
      )}
      <h1 className="font-condensed text-4xl font-black uppercase tracking-tight text-canaletto-cream sm:text-5xl">
        {title}
      </h1>
      {subtitle && <div className="mt-1 text-sm font-semibold text-canaletto-lavender">{subtitle}</div>}
    </div>
    {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
  </div>
);

export const StatStrip = ({ items }) => (
  <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded border border-canaletto-border bg-canaletto-border sm:grid-cols-4">
    {items.map((item) => (
      <div key={item.label} className="bg-canaletto-panel px-4 py-3">
        <div className="font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-lavender">{item.label}</div>
        <div className="mt-1 font-condensed text-2xl font-black text-canaletto-cream">
          {item.value}
          {item.total !== undefined && <span className="ml-1 text-base font-bold text-canaletto-lavender">/ {item.total}</span>}
        </div>
        {item.sub && <div className="mt-0.5 text-xs text-canaletto-lavender">{item.sub}</div>}
      </div>
    ))}
  </div>
);

// Single-line round status banner (director correction pass — was a much
// taller two-line-per-metric strip). Roughly half the height of StatStrip,
// prioritizing vertical space on the active round screen.
export const CompactStatusBar = ({ items }) => (
  <div className="mb-4 flex flex-wrap items-center gap-2 rounded border border-canaletto-border bg-canaletto-panel px-4 py-2">
    {items.map((item, i) => (
      <span key={item.label} className="flex items-center gap-1.5 font-condensed text-sm font-bold uppercase tracking-wide">
        {i > 0 && <span className="text-canaletto-lavender/50">·</span>}
        <span className="text-canaletto-lavender">{item.label}</span>
        <span className="text-canaletto-gold">
          {item.value}
          {item.total !== undefined && <span className="text-canaletto-lavender"> / {item.total}</span>}
        </span>
      </span>
    ))}
  </div>
);

// `compact` tightens the title bar/body padding — used where vertical
// density matters more than breathing room (e.g. Block Results, so its
// 16-row standings columns fit a widescreen viewport without scrolling).
export const Panel = ({ title, accent = 'gold', right, children, className = '', compact = false }) => (
  <div
    className={`rounded border bg-canaletto-panel ${accent === 'magenta' ? 'border-canaletto-magenta/60' : 'border-canaletto-border'} ${className}`}
  >
    {title && (
      <div className={`flex items-center justify-between border-b border-canaletto-border px-4 ${compact ? 'py-1.5' : 'py-3'}`}>
        <h2 className="font-condensed text-xl font-black uppercase tracking-wide text-canaletto-cream">{title}</h2>
        {right}
      </div>
    )}
    <div className={compact ? 'p-2' : 'p-4'}>{children}</div>
  </div>
);

export const SectionHeader = ({ eyebrow, title, right }) => (
  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
    <div>
      {eyebrow && (
        <div className="font-condensed text-xs font-bold uppercase tracking-[0.2em] text-canaletto-magenta">{eyebrow}</div>
      )}
      <h2 className="font-condensed text-3xl font-black uppercase tracking-tight text-canaletto-cream">{title}</h2>
    </div>
    {right && <div className="flex items-center gap-2">{right}</div>}
  </div>
);

const STATUS_STYLES = {
  NOT_STARTED: 'bg-canaletto-panel2 text-canaletto-lavender border-canaletto-border',
  RUNNING: 'bg-canaletto-magenta/15 text-canaletto-magenta border-canaletto-magenta/50',
  LOCKED: 'bg-canaletto-gold/15 text-canaletto-gold border-canaletto-gold/50',
  READY: 'bg-canaletto-gold/15 text-canaletto-gold border-canaletto-gold/50',
  WAITING_FOR_A: 'bg-canaletto-panel2 text-canaletto-lavender border-canaletto-border',
  WAITING_FOR_B: 'bg-canaletto-panel2 text-canaletto-lavender border-canaletto-border',
  WAITING_FOR_BOTH: 'bg-canaletto-panel2 text-canaletto-lavender border-canaletto-border'
};

const STATUS_LABELS = {
  NOT_STARTED: 'Not Started',
  RUNNING: 'Running',
  LOCKED: 'Locked',
  READY: 'Top 16 Ready',
  WAITING_FOR_A: 'Waiting for Block A',
  WAITING_FOR_B: 'Waiting for Block B',
  WAITING_FOR_BOTH: 'Waiting for Blocks'
};

export const StatusBadge = ({ status, className = '' }) => (
  <span
    className={`inline-flex items-center rounded border px-2.5 py-1 font-condensed text-xs font-bold uppercase tracking-widest ${STATUS_STYLES[status] || STATUS_STYLES.NOT_STARTED} ${className}`}
  >
    {STATUS_LABELS[status] || status}
  </span>
);

const VARIANT_CLASSES = {
  gold: 'bg-canaletto-gold text-black hover:bg-canaletto-gold/90 border-canaletto-gold',
  magenta: 'bg-canaletto-magenta text-white hover:bg-canaletto-magenta/90 border-canaletto-magenta',
  outline: 'bg-transparent text-canaletto-cream hover:bg-canaletto-panel2 border-canaletto-border',
  danger: 'bg-transparent text-canaletto-magenta hover:bg-canaletto-magenta/10 border-canaletto-magenta/60'
};

export const ActionButton = ({ variant = 'gold', className = '', children, ...props }) => (
  <button
    type="button"
    className={`rounded border px-4 py-2 font-condensed text-sm font-bold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${className}`}
    {...props}
  >
    {children}
  </button>
);

// Mirrored left/right so a match card reads symmetrically out from the
// center: "GBR · win%" on the left, "win% · GBR" on the right.
const PlayerBlock = ({ name, gbr, winPct, align }) => {
  const gbrPart = gbr != null && <span>GBR {Math.round(gbr)}</span>;
  const winPctPart = winPct != null && <span className="font-bold text-canaletto-gold">{Math.round(winPct)}%</span>;
  const dot = gbr != null && winPct != null && <span> · </span>;
  return (
    <div className={align === 'right' ? 'min-w-0 text-right' : 'min-w-0 text-left'}>
      <div className="truncate font-semibold text-canaletto-cream">{name}</div>
      <div className="truncate text-xs text-canaletto-lavender">
        {align === 'right' ? (
          <>{winPctPart}{dot}{gbrPart}</>
        ) : (
          <>{gbrPart}{dot}{winPctPart}</>
        )}
      </div>
    </div>
  );
};

// A missing-this-round conversion (director correction pass): a match that
// WAS a normal pairing but had one participant marked missing — distinct
// from an ordinary scheduled bye (`match.bye && !match.canalettoMissing`).
// Shows the missing player's original name struck through and the
// opponent's BYE · +1 MP outcome, with Undo (only offered while the round
// is current/unlocked — the caller controls this via `onUndoMissing` being
// present or not).
const MissingCard = ({ match, disabled, onUndoMissing }) => {
  const { originalMatch, playerId } = match.canalettoMissing;
  const missingPlayer = originalMatch.p1.id === playerId ? originalMatch.p1 : originalMatch.p2;
  const opponent = originalMatch.p1.id === playerId ? originalMatch.p2 : originalMatch.p1;
  return (
    <div className="rounded border border-canaletto-magenta/50 bg-canaletto-panel2 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-condensed text-xs font-bold text-canaletto-gold">{match.tbl ?? '—'}</span>
        <span className="font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-magenta">Missing</span>
      </div>
      <div className="grid grid-cols-2 items-center gap-2 text-sm">
        <div>
          <div className="truncate font-semibold text-canaletto-lavender line-through">{missingPlayer.name}</div>
          <div className="text-[10px] font-bold uppercase text-canaletto-magenta">Missing</div>
        </div>
        <div className="text-right">
          <div className="truncate font-semibold text-canaletto-cream">{opponent.name}</div>
          <div className="text-[10px] font-bold uppercase text-canaletto-gold">Bye · +1 MP</div>
        </div>
      </div>
      {onUndoMissing && (
        <ActionButton variant="outline" className="mt-2 w-full px-2 py-1 text-[10px]" disabled={disabled} onClick={onUndoMissing}>
          Undo Missing
        </ActionButton>
      )}
    </div>
  );
};

// Small inline "mark player missing" control — a single "PLAYER MISSING"
// trigger that expands into player choice, then a required confirmation,
// without a full modal (keeps the compact 4-column match grid usable).
// `onMarkMissing(playerId)` is only called after explicit confirmation.
const MissingTrigger = ({ match, roundNumber, onMarkMissing }) => {
  const [step, setStep] = useState('idle'); // 'idle' | 'choose' | 'confirm'
  const [chosen, setChosen] = useState(null);

  if (step === 'idle') {
    return (
      <button
        type="button"
        onClick={() => setStep('choose')}
        className="text-[10px] font-bold uppercase tracking-wide text-canaletto-lavender hover:text-canaletto-magenta"
      >
        PLAYER MISSING
      </button>
    );
  }
  if (step === 'choose') {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] font-bold uppercase text-canaletto-lavender">Who?</span>
        {[match.p1, match.p2].map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => { setChosen(p); setStep('confirm'); }}
            className="rounded border border-canaletto-border px-1.5 py-0.5 text-[10px] font-bold text-canaletto-cream hover:border-canaletto-magenta"
          >
            {p.name}
          </button>
        ))}
        <button type="button" onClick={() => setStep('idle')} className="text-[10px] text-canaletto-lavender">✕</button>
      </div>
    );
  }
  const opponent = chosen.id === match.p1.id ? match.p2 : match.p1;
  return (
    <div className="rounded border border-canaletto-magenta/50 bg-canaletto-panel p-1.5 text-[10px]">
      <div className="mb-1 font-semibold text-canaletto-cream">
        Mark {chosen.name} missing for Round {roundNumber}? {opponent.name} will receive a bye.
      </div>
      <div className="flex gap-1">
        <ActionButton
          variant="magenta"
          className="px-2 py-0.5 text-[10px]"
          onClick={() => { onMarkMissing(chosen.id); setStep('idle'); setChosen(null); }}
        >
          Confirm
        </ActionButton>
        <ActionButton variant="outline" className="px-2 py-0.5 text-[10px]" onClick={() => setStep('idle')}>
          Cancel
        </ActionButton>
      </div>
    </div>
  );
};

// A single compact match card: table id, both players (with GBR + win%
// when supplied), score entry, and Complete/Correct. Authoritative
// completion always goes through the caller's onSubmit ->
// recordBlockMatchResult() -> recordMatchResult() canonical command; this
// component never computes/validates BBS results itself, it only stages the
// two integers that command expects.
//
// FROZEN display: `p1Gbr`/`p2Gbr`/`p1WinPct`/`p2WinPct` are the pairing-time
// snapshot values (see src/canaletto/matchDisplay.js) — this component never
// looks up current/live GBR itself.
//
// Autocomplete UX: an untouched/blank score field resolves to 0 (the
// canonical missing-side value, via resolveScoreField()) rather than
// requiring the director to type 0 into it — recordMatchResult() itself
// still performs the actual autocomplete/validation; nothing is duplicated
// here.
//
// Missing-this-round: `onMarkMissing(playerId)`/`onUndoMissing()` are only
// rendered when supplied (caller omits them for a locked block or a
// non-current round) — see MissingCard/MissingTrigger above. `roundNumber`
// is only used for the confirmation step's copy. `tableOptions` (array of
// configured table labels, see canalettoTables.js) drives the table
// dropdown — the current match's own `tbl` is always included even if it
// isn't one of the configured labels (e.g. the sequential fallback used
// before any tables were configured), so a real assignment is never hidden.
// `tableFrozen` disables ONLY the table dropdown (score entry/etc. stay
// governed by `disabled`) once the round's tables have been confirmed — see
// confirmBlockRoundTables()/editBlockRoundTables() in canalettoEvent.js.
export const MatchRow = ({ match, disabled, onTableChange, onSubmit, onMarkMissing, onUndoMissing, roundNumber, tableOptions = [], tableFrozen = false, p1Gbr, p2Gbr, p1WinPct, p2WinPct }) => {
  const [r1, setR1] = useState(match.done ? String(match.r1) : '');
  const [r2, setR2] = useState(match.done ? String(match.r2) : '');
  const [editing, setEditing] = useState(!match.done);

  useEffect(() => {
    setR1(match.done ? String(match.r1) : '');
    setR2(match.done ? String(match.r2) : '');
    setEditing(!match.done);
  }, [match.id, match.done, match.r1, match.r2]);

  if (match.bye) {
    if (match.canalettoMissing) {
      return <MissingCard match={match} disabled={disabled} onUndoMissing={!disabled ? onUndoMissing : null} />;
    }
    return (
      <div className="flex items-center justify-between rounded border border-canaletto-border bg-canaletto-panel2 px-2 py-2.5">
        <div className="font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-lavender">Bye</div>
        <div className="font-semibold text-canaletto-cream">{match.p1.name}</div>
      </div>
    );
  }

  const submit = () => {
    const n1 = resolveScoreField(r1);
    const n2 = resolveScoreField(r2);
    if (n1 === null || n2 === null) return; // non-integer input — do not submit
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
        <span className={`font-condensed text-xs font-bold uppercase tracking-widest ${match.done ? 'text-canaletto-gold' : match.cancelled ? 'text-canaletto-magenta' : 'text-canaletto-lavender'}`}>
          {match.done ? 'Done' : match.cancelled ? 'Cancelled' : 'Pending'}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <PlayerBlock name={match.p1.name} gbr={p1Gbr} winPct={p1WinPct} align="left" />
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
        <PlayerBlock name={match.p2.name} gbr={p2Gbr} winPct={p2WinPct} align="right" />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        {onMarkMissing && !disabled && !match.done ? (
          <MissingTrigger match={match} roundNumber={roundNumber} onMarkMissing={onMarkMissing} />
        ) : (
          <span />
        )}
        {editing ? (
          <ActionButton variant="gold" className="px-2 py-1 text-xs" disabled={disabled} onClick={submit}>
            {match.done ? 'Save' : 'Complete Match'}
          </ActionButton>
        ) : (
          <ActionButton variant="outline" className="px-2 py-1 text-xs" disabled={disabled} onClick={() => setEditing(true)}>
            Edit Result
          </ActionButton>
        )}
      </div>
    </div>
  );
};

// Read-only compact match card for the All Rounds / historical overview
// (never editable — All Rounds remains an operational overview only, not an
// archive product). Shares PlayerBlock with MatchRow so frozen GBR/win%
// render identically in both places; caller supplies frozen values (see
// src/canaletto/matchDisplay.js) — this component never looks anything up
// itself.
// `tablesConfirmed` (director correction pass): a round's table assignments
// only appear here once the director has explicitly confirmed that round's
// tables (see confirmBlockRoundTables()/isRoundTablesConfirmed() in
// canalettoEvent.js) — before that, the table cell shows "—" even though
// `match.tbl` already has a real value, so All Rounds never surfaces a
// still-provisional table layout.
export const MatchSummaryCard = ({ match, tablesConfirmed, p1Gbr, p2Gbr, p1WinPct, p2WinPct }) => {
  if (match.bye) {
    if (match.canalettoMissing) {
      const { originalMatch, playerId } = match.canalettoMissing;
      const missingPlayer = originalMatch.p1.id === playerId ? originalMatch.p1 : originalMatch.p2;
      const opponent = originalMatch.p1.id === playerId ? originalMatch.p2 : originalMatch.p1;
      return (
        <div className="rounded border border-canaletto-magenta/40 bg-canaletto-panel2 p-2">
          <div className="grid grid-cols-2 items-center gap-2 text-sm">
            <div>
              <div className="truncate font-semibold text-canaletto-lavender line-through">{missingPlayer.name}</div>
              <div className="text-[10px] font-bold uppercase text-canaletto-magenta">Missing</div>
            </div>
            <div className="text-right">
              <div className="truncate font-semibold text-canaletto-cream">{opponent.name}</div>
              <div className="text-[10px] font-bold uppercase text-canaletto-gold">Bye · +1 MP</div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-between rounded border border-canaletto-border bg-canaletto-panel2 px-3 py-3">
        <div className="font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-lavender">Bye</div>
        <div className="font-semibold text-canaletto-cream">{match.p1.name}</div>
      </div>
    );
  }
  return (
    <div className="rounded border border-canaletto-border bg-canaletto-panel2 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-condensed text-xs font-bold text-canaletto-gold">{tablesConfirmed ? (match.tbl ?? '—') : '—'}</span>
        <span className={`font-condensed text-xs font-bold uppercase tracking-widest ${match.done ? 'text-canaletto-gold' : match.cancelled ? 'text-canaletto-magenta' : 'text-canaletto-lavender'}`}>
          {match.done ? 'Done' : match.cancelled ? 'Cancelled' : 'Pending'}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <PlayerBlock name={match.p1.name} gbr={p1Gbr} winPct={p1WinPct} align="left" />
        <div className="text-center font-condensed text-xl font-black text-canaletto-gold">
          {match.done ? `${match.r1} : ${match.r2}` : 'vs'}
        </div>
        <PlayerBlock name={match.p2.name} gbr={p2Gbr} winPct={p2WinPct} align="right" />
      </div>
    </div>
  );
};

// Standings table shared by Round/AllRounds/BlockResults/Landing-adjacent
// views. `qualificationThreshold` draws the CUT divider and highlights
// players currently inside it — this is a live-position indicator before
// lock, and reflects the frozen order after lock (callers pass the frozen
// qualifiers-as-players list post-lock).
const formatDelta = (n) => {
  const rounded = Math.round(n);
  if (rounded > 0) return `+${rounded}`;
  if (rounded < 0) return `${rounded}`;
  return '±0';
};

// Row height is deliberately tight (py-1, text-sm) so a full 16-row column
// (the Block Results 1-16 / 17-32 split) fits a normal widescreen viewport
// without scrolling — the dominant cost at 16+ rows is per-row padding, not
// the surrounding page chrome.
export const StandingsTable = ({ players, qualificationThreshold }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[560px] border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-canaletto-border text-[11px] font-bold uppercase tracking-widest text-canaletto-lavender">
          <th className="px-2 py-1">#</th>
          <th className="px-2 py-1">Player</th>
          <th className="px-2 py-1 text-right">MP</th>
          <th className="px-2 py-1 text-right">Rack Diff</th>
          <th className="px-2 py-1 text-right">Perf</th>
          <th className="px-2 py-1">GBR</th>
        </tr>
      </thead>
      <tbody>
        {players.map((p, i) => {
          const rank = p.rank ?? i + 1;
          const qualifies = qualificationThreshold != null && rank <= qualificationThreshold;
          const isCutLine = qualificationThreshold != null && rank === qualificationThreshold + 1;
          const diff = p.diff !== undefined ? p.diff : (p.racksWon || 0) - (p.racksLost || 0);
          // A frozen qualifier (post-lock) already stores an AVERAGE perf and
          // has no perfCount; a raw Player (pre-lock) stores an accumulated
          // SUM in `perf` alongside `perfCount` and must be averaged here.
          const perf = p.perfCount !== undefined ? (p.perfCount > 0 ? p.perf / p.perfCount : 0) : p.perf;
          const gbr = p.gbr !== undefined ? p.gbr : p.elo;
          const hasDelta = p.deltaGbr !== undefined;
          // LOCKED QUALIFIER (director correction pass, item 6): once a
          // block is locked, its frozen qualifier IDENTITIES (set by
          // getBlockResultsRows()) turn magenta — a stronger, permanent
          // signal, distinct from the ordinary gold "currently qualifying"
          // highlight that only applies pre-lock.
          const locked = p.lockedQualifier === true;
          return (
            <tr
              key={p.playerId ?? p.id}
              className={`border-b border-canaletto-border/60 ${isCutLine ? 'border-t-2 border-t-canaletto-magenta' : ''} ${locked ? 'bg-canaletto-magenta/5' : qualifies ? 'bg-canaletto-gold/5' : ''}`}
            >
              <td className={`px-2 py-1 font-condensed text-base font-black ${locked ? 'text-canaletto-magenta' : qualifies ? 'text-canaletto-gold' : 'text-canaletto-lavender'}`}>{rank}</td>
              <td className={`px-2 py-1 font-semibold ${locked ? 'text-canaletto-magenta' : 'text-canaletto-cream'}`}>{p.name}</td>
              <td className="px-2 py-1 text-right text-canaletto-cream">{p.mp}</td>
              <td className={`px-2 py-1 text-right font-bold ${diff > 0 ? 'text-canaletto-gold' : 'text-canaletto-lavender'}`}>
                {diff > 0 ? `+${diff}` : diff}
              </td>
              <td className="px-2 py-1 text-right text-canaletto-cream">{Math.round(perf)}</td>
              <td className="px-2 py-1 font-bold text-canaletto-cream">
                {Math.round(Number(gbr))}
                {hasDelta && <span className="ml-1 text-[11px] font-semibold text-canaletto-lavender">({formatDelta(p.deltaGbr)})</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
