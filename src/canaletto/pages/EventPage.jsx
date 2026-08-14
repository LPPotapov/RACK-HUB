import { useState } from 'react';
import {
  canEditSettings,
  getBlockStatus,
  getTop16Status,
  setEventTables,
  updateCanalettoSettings
} from '../../application/canalettoEvent.js';
import { TableConfigModal } from '../TableConfigModal.jsx';
import { ActionButton, Panel, PageHeader, StatusBadge } from '../ui.jsx';

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

      <div className="mt-4 flex items-center gap-3">
        <ActionButton variant="outline" onClick={() => setShowTableConfig(true)}>Table Configuration</ActionButton>
        <span className="text-xs text-canaletto-lavender">
          {event.tables.length > 0 ? `${event.tables.length} tables configured` : 'No tables configured yet'}
        </span>
      </div>

      {showTableConfig && (
        <TableConfigModal
          tables={event.tables}
          onSave={(tables) => run(setEventTables, tables)}
          onClose={() => setShowTableConfig(false)}
        />
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
