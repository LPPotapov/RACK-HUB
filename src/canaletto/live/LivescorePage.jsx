// Public Livescore page (LIVE/public correction pass) — a small READ-ONLY
// application with its own left-side navigation (PLAYERS / BLOCK A / BLOCK
// B / TOP16), replacing the previous single long-scrolling page. Composes
// EXISTING, already-approved display components (ui.jsx's
// MatchSummaryCard/StandingsTable, koUi.jsx's BracketOverview,
// matchDisplay.js's frozenMatchDisplay) exactly as the director app's own
// BlockPage.jsx/Top16Page.jsx do — this page adds no new BBS/GBR rendering
// logic, only a read-only composition + navigation shell. Internal React
// tab state (not a routing library) — same "smallest safe implementation"
// choice liveLinks.js documents for the top-level `?live=` routes.
//
// SCOPE GUARD: this module must never import a mutating command from
// application/canalettoEvent.js (result recording, table assignment,
// lock/start/edit/confirm/reset/missing-player operations, etc.) or any
// director-only editing UI. Only read/query functions and read-only display
// components. See the source-scan test in tests/canaletto-live.test.js that
// enforces this for every public page.

import { useState } from 'react';
import {
  getBlockResultsRows,
  getBlockStatus,
  getBracketProjection,
  getRoundStandings,
  getTop16Status,
  isRoundTablesConfirmed
} from '../../application/canalettoEvent.js';
import { frozenMatchDisplay } from '../matchDisplay.js';
import { BracketOverview } from '../koUi.jsx';
import { MatchSummaryCard, PageHeader, Panel, SectionHeader, StatusBadge } from '../ui.jsx';
import { LiveBrandMark, TwoColumnStandings } from './liveComponents.jsx';
import { useCanalettoEventReadOnly } from './useCanalettoEventReadOnly.js';

const MATCH_GRID_CLASSES = 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4';

const PUBLIC_NAV_ITEMS = [
  { id: 'players', label: 'Players', code: 'PL' },
  { id: 'blockA', label: 'Block A', code: 'A' },
  { id: 'blockB', label: 'Block B', code: 'B' },
  { id: 'top16', label: 'Top16', code: '16' }
];

const PublicSidebar = ({ event, section, onNavigate }) => (
  <aside className="flex w-52 shrink-0 flex-col border-r border-canaletto-border bg-canaletto-panel">
    <div className="flex items-center gap-2 border-b border-canaletto-border px-4 py-4">
      <LiveBrandMark className="h-9 w-9 shrink-0" />
      <div>
        <div className="font-condensed text-lg font-black uppercase leading-none tracking-wide text-canaletto-cream">{event.settings.title || 'Canaletto'}</div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-canaletto-lavender">Public Livescore</div>
      </div>
    </div>
    <nav className="flex-1 py-3">
      {PUBLIC_NAV_ITEMS.map((item) => {
        const active = section === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className={`flex w-full items-center gap-2 border-l-2 px-4 py-2.5 text-left font-condensed text-sm font-bold uppercase tracking-wide transition ${
              active
                ? 'border-canaletto-gold bg-canaletto-panel2 text-canaletto-gold'
                : 'border-transparent text-canaletto-lavender hover:bg-canaletto-panel2 hover:text-canaletto-cream'
            }`}
          >
            <span className="flex h-5 w-6 items-center justify-center rounded bg-canaletto-panel2 text-[10px] text-canaletto-lavender">
              {item.code}
            </span>
            <span className="flex-1">{item.label}</span>
          </button>
        );
      })}
    </nav>
  </aside>
);

// PLAYERS — the pre-tournament player-field overview, NOT a standings page
// (director correction pass): name + START GBR only, for both blocks,
// always read from the block's roster (the original registration record —
// see canalettoEvent.js's `tournament.roster`), never from
// getBlockStandings()/tournament.players (current/recalculated GBR, MP,
// rack diff, PERF, qualification). This stays true regardless of block
// status — even once a block is running/locked, PLAYERS still shows only
// the starting field; Block A/B's own Results tab is where the actual
// tournament standings live.
const PublicRosterTable = ({ roster }) => (
  <div className="overflow-hidden rounded border border-canaletto-border">
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-canaletto-border text-[11px] font-bold uppercase tracking-widest text-canaletto-lavender">
          <th className="px-2 py-1">#</th>
          <th className="px-2 py-1">Player</th>
          <th className="px-2 py-1 text-right">Start GBR</th>
        </tr>
      </thead>
      <tbody>
        {roster.map((p, i) => (
          <tr key={p.id} className="border-b border-canaletto-border/60">
            <td className="px-2 py-1 text-canaletto-lavender">{i + 1}</td>
            <td className="px-2 py-1 font-semibold text-canaletto-cream">{p.name}</td>
            <td className="px-2 py-1 text-right font-bold text-canaletto-gold">{p.elo}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const PublicPlayersColumn = ({ event, block }) => {
  const status = getBlockStatus(event, block);
  const roster = event[`block${block}`].tournament.roster;
  return (
    <div>
      <SectionHeader eyebrow="Roster" title={`Block ${block}`} right={<StatusBadge status={status} />} />
      <PublicRosterTable roster={roster} />
    </div>
  );
};

const PlayersSection = ({ event }) => (
  <div>
    <PageHeader eyebrow="Roster" title="Players" subtitle="Block A and Block B — starting field and Start GBR." />
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <PublicPlayersColumn event={event} block="A" />
      <PublicPlayersColumn event={event} block="B" />
    </div>
  </div>
);

// BLOCK A/B — ALL ROUNDS (read-only round-by-round history) / RESULTS
// (current or final standings) only. No round-operation/scoring tab, no
// director controls — see the module-level SCOPE GUARD note above.
const AllRoundsSection = ({ event, block }) => {
  const tournament = event[`block${block}`].tournament;
  const rounds = Array.from({ length: tournament.currentRound }, (_, i) => i + 1);

  if (rounds.length === 0) {
    return <div className="text-sm text-canaletto-lavender">Block {block} has not started yet.</div>;
  }

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

const ResultsSection = ({ event, block }) => {
  const rows = getBlockResultsRows(event, block);
  return (
    <Panel title="Results" compact>
      <div className="mb-1 text-[11px] text-canaletto-lavender">Sort order: Match Points, then Rack Diff, then PERF/GBR.</div>
      <TwoColumnStandings rows={rows} qualificationThreshold={event.settings.qualificationThreshold} />
    </Panel>
  );
};

const BLOCK_TABS = [
  { id: 'all', label: 'All Rounds' },
  { id: 'results', label: 'Results' }
];

const BlockSection = ({ event, block }) => {
  const status = getBlockStatus(event, block);
  const [tab, setTab] = useState('all');

  return (
    <div>
      <PageHeader eyebrow="Group Stage" title={`Block ${block}`} right={<StatusBadge status={status} />} />
      {status === 'NOT_STARTED' ? (
        <Panel><div className="text-canaletto-lavender">Block {block} has not started yet.</div></Panel>
      ) : (
        <>
          <div className="mb-4 flex gap-2 border-b border-canaletto-border pb-2">
            {BLOCK_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded border px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-wider ${
                  tab === t.id ? 'border-canaletto-gold bg-canaletto-gold text-black' : 'border-canaletto-border text-canaletto-lavender hover:text-canaletto-cream'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'all' && <AllRoundsSection event={event} block={block} />}
          {tab === 'results' && <ResultsSection event={event} block={block} />}
        </>
      )}
    </div>
  );
};

// TOP16 — bracket only (director correction pass item 10): no calibration
// table, no director match cards, no danger zone, no score-control UI.
// Reuses koUi.jsx's BracketOverview directly — the SAME projection-driven
// bracket the director app's Top16 page and the full-screen bracket overlay
// render, showing Top16/QF/SF/Final with progressive population as each
// stage is generated.
const Top16Section = ({ event }) => {
  const status = getTop16Status(event);
  const projection = getBracketProjection(event);
  const gbrConfig = event.blockA.tournament.config;

  return (
    <div>
      <PageHeader eyebrow="Knockout" title="Top 16" right={<StatusBadge status={status} />} />
      <BracketOverview projection={projection} ko={event.ko} schedule={event.schedule} gbrConfig={gbrConfig} />
    </div>
  );
};

export const LivescorePage = () => {
  const event = useCanalettoEventReadOnly();
  const [section, setSection] = useState('players');

  return (
    <div className="flex min-h-screen bg-canaletto-bg text-canaletto-cream">
      <PublicSidebar event={event} section={section} onNavigate={setSection} />
      <main className="flex-1 px-8 py-6">
        {section === 'players' && <PlayersSection event={event} />}
        {section === 'blockA' && <BlockSection event={event} block="A" />}
        {section === 'blockB' && <BlockSection event={event} block="B" />}
        {section === 'top16' && <Top16Section event={event} />}
      </main>
    </div>
  );
};
