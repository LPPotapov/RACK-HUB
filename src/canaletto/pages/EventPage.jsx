import { useEffect, useState } from 'react';
import {
  canEditSettings,
  getBlockStatus,
  getKoGbrWeight,
  getTop16Status,
  setEventTables,
  updateCanalettoSchedule,
  updateCanalettoSettings,
  updateKoGbrWeight
} from '../../application/canalettoEvent.js';
import { parseEuDateTimeInputs, toEuDateInputValue, toEuTimeInputValue } from '../schedule.js';
import { TableConfigModal } from '../TableConfigModal.jsx';
import { BackupDataPanel } from '../BackupControls.jsx';
import { ActionButton, Panel, PageHeader, StatusBadge } from '../ui.jsx';

const SCHEDULE_GROUPS = [
  { key: 'blockA', label: 'Block A' },
  { key: 'blockB', label: 'Block B' },
  { key: 'top16Slot1', label: 'Top 16 — Slot 1' },
  { key: 'top16Slot2', label: 'Top 16 — Slot 2' },
  { key: 'quarterfinals', label: 'Quarterfinals' },
  { key: 'semifinals', label: 'Semifinals' },
  { key: 'final', label: 'Final' }
];

// Plain EU-formatted text fields (DD.MM.YYYY + HH:MM), NOT a native
// `<input type="datetime-local">` — that native widget's stored value is
// locale-independent, but its RENDERED widget always follows the browser/OS
// locale (MM/DD/YYYY + AM/PM on a US-locale machine), which is exactly the
// "American format" this correction rules out for the input fields too, not
// just the read-only display. There is no HTML/CSS way to force a native
// date/time input's displayed format, so this field owns its own local text
// state and commits through parseEuDateTimeInputs() whenever the typed text
// forms a complete, valid value (partial typing — e.g. "14.08.2" — is kept
// on-screen without committing, rather than being rejected/reset).
const EuDateTimeField = ({ value, onChange }) => {
  const [dateText, setDateText] = useState(() => toEuDateInputValue(value));
  const [timeText, setTimeText] = useState(() => toEuTimeInputValue(value));

  useEffect(() => {
    setDateText(toEuDateInputValue(value));
    setTimeText(toEuTimeInputValue(value));
  }, [value]);

  const commit = (nextDate, nextTime) => {
    const parsed = parseEuDateTimeInputs(nextDate, nextTime);
    if (parsed !== null) onChange(parsed);
  };

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        inputMode="numeric"
        placeholder="DD.MM.YYYY"
        className="input w-24 text-center"
        value={dateText}
        onChange={(e) => { setDateText(e.target.value); commit(e.target.value, timeText); }}
      />
      <input
        type="text"
        inputMode="numeric"
        placeholder="HH:MM"
        className="input w-20 text-center"
        value={timeText}
        onChange={(e) => { setTimeText(e.target.value); commit(dateText, e.target.value); }}
      />
    </div>
  );
};

// Shared compact modal chrome (matches TableConfigModal.jsx exactly) — used
// by both TimeScheduleModal and KoGbrWeightModal so all three Event Settings
// pop-ups (Table Configuration, Time Schedule, KO GBR Weight) look and
// behave identically.
const ModalShell = ({ title, maxWidth = 'max-w-xl', onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
    <div className={`w-full ${maxWidth} max-h-[85vh] overflow-y-auto rounded border border-canaletto-border bg-canaletto-panel p-5 shadow-xl`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-condensed text-2xl font-black uppercase text-canaletto-cream">{title}</h2>
        <button type="button" onClick={onClose} className="font-condensed text-xs font-bold uppercase text-canaletto-lavender hover:text-canaletto-cream">
          Close
        </button>
      </div>
      {children}
    </div>
  </div>
);

// Estimated schedule (director correction pass, item 5), now a pop-up modal
// like Table Configuration rather than a permanent inline panel — optional,
// simple EU-formatted date/time inputs (never American MM/DD/YYYY or
// 12-hour AM/PM), never gating tournament operation. Commits directly on
// change (no separate Save — Done just closes the already-live modal).
const TimeScheduleModal = ({ event, run, onClose }) => (
  <ModalShell title="Event Schedule (Estimated)" maxWidth="max-w-2xl" onClose={onClose}>
    <div className="mb-3 text-xs text-canaletto-lavender">
      Optional planning estimates (DD.MM.YYYY, 24h). Blank values are fine — tournament operation never depends on these.
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {SCHEDULE_GROUPS.map(({ key, label }) => {
        const entry = event.schedule[key] || { start: '', end: '' };
        return (
          <div key={key} className="rounded border border-canaletto-border bg-canaletto-panel2 px-3 py-2">
            <div className="mb-1 font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-lavender">{label}</div>
            <div className="flex flex-wrap items-center gap-2">
              <EuDateTimeField value={entry.start} onChange={(iso) => run(updateCanalettoSchedule, key, { start: iso, end: entry.end })} />
              <span className="text-canaletto-lavender">–</span>
              <EuDateTimeField value={entry.end} onChange={(iso) => run(updateCanalettoSchedule, key, { start: entry.start, end: iso })} />
            </div>
          </div>
        );
      })}
    </div>
    <div className="mt-4 flex justify-end">
      <ActionButton variant="gold" onClick={onClose}>Done</ActionButton>
    </div>
  </ModalShell>
);

// Single-KO GBR Weight (docs task item 17-22), now a pop-up modal like
// Table Configuration rather than a permanent inline panel — a compact,
// ALWAYS-editable control (never gated by canEditSettings()/the settings
// lock — see updateKoGbrWeight()'s own comment in canalettoEvent.js for
// why). Director enters a whole percentage (0-100); stored internally as a
// 0..1 fraction. Negative values are impossible to enter via `min="0"`;
// values above 100 are clamped on commit rather than silently accepted.
const KoGbrWeightModal = ({ event, run, onClose }) => {
  const weightPct = Math.round(getKoGbrWeight(event) * 100);
  return (
    <ModalShell title="KO GBR Weight" maxWidth="max-w-md" onClose={onClose}>
      <div className="mb-3 text-xs text-canaletto-lavender">
        Applies ONLY to the Top16/QF/SF/Final knockout phase — Block A/B GBR is always full weight, unaffected. Default 50%.
      </div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min="0"
          max="100"
          className="input w-20 text-right"
          value={weightPct}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            run(updateKoGbrWeight, Math.min(100, Math.max(0, n)) / 100);
          }}
        />
        <span className="font-condensed text-sm font-bold text-canaletto-lavender">%</span>
      </div>
      <div className="mt-4 flex justify-end">
        <ActionButton variant="gold" onClick={onClose}>Done</ActionButton>
      </div>
    </ModalShell>
  );
};

const BlockCard = ({ label, status, playerCount, roundLine }) => (
  <Panel accent={status === 'RUNNING' ? 'magenta' : 'gold'}>
    <div className="flex items-start justify-between">
      <div>
        <div className="font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-lavender">Block</div>
        <div className="font-condensed text-3xl font-black text-canaletto-cream">{label}</div>
      </div>
      <StatusBadge status={status} />
    </div>
    <div className="mt-4 text-sm text-canaletto-lavender">
      {playerCount} Players{roundLine ? <> &middot; {roundLine}</> : null}
    </div>
  </Panel>
);

export const EventPage = ({ event, run, onNavigate }) => {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(event.settings);
  const [showTableConfig, setShowTableConfig] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showKoGbrWeight, setShowKoGbrWeight] = useState(false);

  const statusA = getBlockStatus(event, 'A');
  const statusB = getBlockStatus(event, 'B');
  const top16Status = getTop16Status(event);
  const editable = canEditSettings(event);

  const startEdit = () => {
    setForm(event.settings);
    setEditing(true);
  };

  const save = () => {
    const ok = run(updateCanalettoSettings, {
      title: form.title,
      venue: form.venue,
      date: form.date,
      roundsPerBlock: Number(form.roundsPerBlock) || event.settings.roundsPerBlock,
      racksPerMatch: Number(form.racksPerMatch) || event.settings.racksPerMatch,
      round1SeedMethod: form.round1SeedMethod,
      qualificationThreshold: Number(form.qualificationThreshold) || event.settings.qualificationThreshold
    });
    if (ok) setEditing(false);
  };

  return (
    <div>
      <PageHeader
        eyebrow="9-Ball · Fixed Rack · GBR"
        title={event.settings.title}
        subtitle={[event.settings.venue, event.settings.date].filter(Boolean).join(' · ') || 'Set venue/date in Event Settings'}
      />

      <BackupDataPanel event={event} run={run} source="event" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <button type="button" onClick={() => onNavigate('blockA')} className="text-left">
          <BlockCard label="A" status={statusA} playerCount={event.blockA.tournament.roster.length} roundLine={statusA === 'RUNNING' ? `Round ${event.blockA.tournament.currentRound}/${event.blockA.tournament.totalRounds}` : null} />
        </button>
        <button type="button" onClick={() => onNavigate('blockB')} className="text-left">
          <BlockCard label="B" status={statusB} playerCount={event.blockB.tournament.roster.length} roundLine={statusB === 'RUNNING' ? `Round ${event.blockB.tournament.currentRound}/${event.blockB.tournament.totalRounds}` : null} />
        </button>
        <button type="button" onClick={() => onNavigate('top16')} className="text-left">
          <Panel accent={top16Status === 'READY' || top16Status === 'RUNNING' ? 'magenta' : 'gold'}>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-lavender">Knockout</div>
                <div className="font-condensed text-3xl font-black text-canaletto-cream">Top 16</div>
              </div>
              <StatusBadge status={top16Status} />
            </div>
            <div className="mt-4 text-sm text-canaletto-lavender">Seeded strictly from frozen block rank</div>
          </Panel>
        </button>
      </div>

      <Panel
        title="Event Settings"
        right={
          editable && !editing ? (
            <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={startEdit}>Edit</ActionButton>
          ) : null
        }
      >
        {!editable && (
          <div className="mb-3 rounded border border-canaletto-border bg-canaletto-panel2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-canaletto-lavender">
            Locked once a block has started — this preserves the meaning of frozen qualifiers.
          </div>
        )}
        {editing ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Title">
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Venue">
              <input className="input" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
            </Field>
            <Field label="Date">
              <input className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} placeholder="e.g. 15.8.2026" />
            </Field>
            <Field label="Rounds per Block">
              <input type="number" min="1" className="input" value={form.roundsPerBlock} onChange={(e) => setForm({ ...form, roundsPerBlock: e.target.value })} />
            </Field>
            <Field label="Fixed Racks per Match">
              <input type="number" min="1" className="input" value={form.racksPerMatch} onChange={(e) => setForm({ ...form, racksPerMatch: e.target.value })} />
            </Field>
            <Field label="Round 1 Seeding">
              <select className="input" value={form.round1SeedMethod} onChange={(e) => setForm({ ...form, round1SeedMethod: e.target.value })}>
                <option value="cross_elo">Cross GBR (cross_elo)</option>
                <option value="random">Random</option>
              </select>
            </Field>
            <Field label="Qualification Threshold">
              <input type="number" min="1" className="input" value={form.qualificationThreshold} onChange={(e) => setForm({ ...form, qualificationThreshold: e.target.value })} />
            </Field>
            <div className="flex items-end gap-2">
              <ActionButton variant="gold" onClick={save}>Save</ActionButton>
              <ActionButton variant="outline" onClick={() => setEditing(false)}>Cancel</ActionButton>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SettingReadout label="Rounds per Block" value={event.settings.roundsPerBlock} />
            <SettingReadout label="Fixed Racks per Match" value={event.settings.racksPerMatch} />
            <SettingReadout label="Round 1 Seeding" value={event.settings.round1SeedMethod === 'cross_elo' ? 'Cross GBR' : event.settings.round1SeedMethod} />
            <SettingReadout label="Qualification Threshold" value={`Top ${event.settings.qualificationThreshold}`} />
          </div>
        )}
      </Panel>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ActionButton variant="outline" onClick={() => setShowTableConfig(true)}>Table Configuration</ActionButton>
        <ActionButton variant="outline" onClick={() => setShowSchedule(true)}>Time Schedule</ActionButton>
        <ActionButton variant="outline" onClick={() => setShowKoGbrWeight(true)}>KO GBR Weight</ActionButton>
        <span className="text-xs text-canaletto-lavender">
          {event.tables.length > 0 ? `${event.tables.length} tables configured` : 'No tables configured yet'}
          {' · '}KO GBR Weight {Math.round(getKoGbrWeight(event) * 100)}%
        </span>
      </div>

      {showTableConfig && (
        <TableConfigModal
          tables={event.tables}
          onSave={(tables) => run(setEventTables, tables)}
          onClose={() => setShowTableConfig(false)}
        />
      )}
      {showSchedule && (
        <TimeScheduleModal event={event} run={run} onClose={() => setShowSchedule(false)} />
      )}
      {showKoGbrWeight && (
        <KoGbrWeightModal event={event} run={run} onClose={() => setShowKoGbrWeight(false)} />
      )}
    </div>
  );
};

const Field = ({ label, children }) => (
  <label className="block">
    <div className="mb-1 font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-lavender">{label}</div>
    {children}
  </label>
);

const SettingReadout = ({ label, value }) => (
  <div>
    <div className="font-condensed text-xs font-bold uppercase tracking-widest text-canaletto-lavender">{label}</div>
    <div className="mt-1 font-condensed text-xl font-black text-canaletto-cream">{value}</div>
  </div>
);
