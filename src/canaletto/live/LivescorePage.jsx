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
  getKoChampion,
  getRoundStandings,
  getTop16Status,
  isRoundTablesConfirmed
} from '../../application/canalettoEvent.js';
import { getLiveDraftScore } from '../../application/canalettoLive.js';
import { frozenMatchDisplay } from '../matchDisplay.js';
import { BracketOverview, ChampionBanner, MobileKoStageView } from '../koUi.jsx';
import { MatchSummaryCard, PageHeader, Panel, SectionHeader, StatusBadge } from '../ui.jsx';
import { CANALETTO_PUBLIC_EVENT_TITLE, isCanalettoPublicDomain } from '../publicDomain.js';
import { LiveBrandMark, TwoColumnStandings } from './liveComponents.jsx';
import { EMPTY_PUBLIC_STATE, useCloudPublicEvent } from './useCloudPublicEvent.js';

const MATCH_GRID_CLASSES = 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4';

const PUBLIC_NAV_ITEMS = [
  { id: 'players', label: 'Players', code: 'PL' },
  { id: 'blockA', label: 'Block A', code: 'A' },
  { id: 'blockB', label: 'Block B', code: 'B' },
  { id: 'top16', label: 'Top16', code: '16' }
];

// FIXED navigation rail — deliberately never replaced by a horizontal/
// hamburger mobile nav (docs task item 10, "IMPORTANT CORRECTION"): a
// participant scrolling far down long content (rounds, standings, a full
// KO stage) must NEVER have to scroll back to the top just to navigate
// elsewhere. Below `lg`, it becomes a COMPACT icon-rail (narrower width,
// smaller logo/padding/text, labels stacked under their badge instead of
// beside it) rather than a scaled-down desktop sidebar — every nav option
// and its label stays visible and tappable at every width, just smaller.
// The page shell (LivescorePage below) makes ONLY the right content
// scroll — this element itself never needs to scroll on a normal phone
// (only 4 nav items), so it has no overflow handling of its own.
const PublicSidebar = ({ event, section, onNavigate }) => (
  <aside className="flex h-dvh w-16 shrink-0 flex-col border-r border-canaletto-border bg-canaletto-panel sm:w-20 lg:w-52">
    <div className="flex flex-col items-center gap-1 border-b border-canaletto-border px-1 py-3 lg:flex-row lg:items-center lg:gap-2 lg:px-4 lg:py-4">
      <LiveBrandMark className="h-7 w-7 shrink-0 lg:h-9 lg:w-9" />
      <div className="hidden lg:block">
        <div className="font-condensed text-lg font-black uppercase leading-none tracking-wide text-canaletto-cream">{event.settings.title || 'Canaletto'}</div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-canaletto-lavender">Public Livescore</div>
      </div>
      <div className="text-center text-[8px] font-bold uppercase leading-tight tracking-widest text-canaletto-lavender lg:hidden">Live</div>
    </div>
    <nav className="flex-1 py-2 lg:py-3">
      {PUBLIC_NAV_ITEMS.map((item) => {
        const active = section === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className={`flex w-full flex-col items-center gap-1 border-l-2 px-1 py-3 text-center font-condensed text-[10px] font-bold uppercase tracking-wide transition lg:flex-row lg:gap-2 lg:px-4 lg:py-2.5 lg:text-left lg:text-sm ${
              active
                ? 'border-canaletto-gold bg-canaletto-panel2 text-canaletto-gold'
                : 'border-transparent text-canaletto-lavender hover:bg-canaletto-panel2 hover:text-canaletto-cream'
            }`}
          >
            <span className="flex h-5 w-6 shrink-0 items-center justify-center rounded bg-canaletto-panel2 text-[10px] text-canaletto-lavender">
              {item.code}
            </span>
            <span className="flex-1 leading-tight">{item.label}</span>
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

// Large event-identity banner for the public custom domain's PLAYERS
// landing page (canaletto.bc-joes.de root) — the archive-task requirement
// that a viewer landing cold on the page immediately know what event
// they're looking at, since the browser-tab title and ChampionBanner's
// small eyebrow text aren't prominent enough on their own. Gated by
// isCanalettoPublicDomain() so rack-hub-canaletto.web.app (director host,
// including its own `?live=livescore` access) never shows it. Reuses the
// same gold-border/condensed-type language as koUi.jsx's ChampionBanner;
// venue/date come from the same event.settings fields EventPage.jsx's own
// subtitle already reads, left out entirely when unset rather than
// inventing placeholder text. The primary title itself is the fixed
// CANALETTO_PUBLIC_EVENT_TITLE constant, not event.settings.title —
// production's Firebase data only has "Canaletto Cup" (no year), and this
// banner is a presentation-layer label, not a mirror of tournament data.
const PublicEventBanner = ({ event }) => {
  const subtitle = [event.settings.venue, event.settings.date].filter(Boolean).join(' · ');
  return (
    <div className="mb-6 rounded border-2 border-canaletto-gold bg-canaletto-gold/10 px-4 py-5 text-center sm:px-6">
      <h1 className="break-words font-condensed text-3xl font-black uppercase leading-tight tracking-tight text-canaletto-gold sm:text-5xl lg:text-6xl">
        {CANALETTO_PUBLIC_EVENT_TITLE}
      </h1>
      {subtitle && (
        <div className="mt-2 text-xs font-bold uppercase tracking-widest text-canaletto-lavender sm:text-sm">{subtitle}</div>
      )}
    </div>
  );
};

const PlayersSection = ({ event }) => (
  <div>
    {isCanalettoPublicDomain() && <PublicEventBanner event={event} />}
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
                draftScore={!m.bye && !m.done ? getLiveDraftScore(event, { source: 'block', block, roundNumber: r, matchId: m.id }) : null}
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

const KO_MOBILE_STAGE_TABS = [
  { id: 'top16', label: 'Top16' },
  { id: 'quarterfinals', label: 'QF' },
  { id: 'semifinals', label: 'SF' },
  { id: 'final', label: 'Final' }
];

// Below `lg`, the full 4-column desktop bracket (BracketOverview) does not
// fit a phone width readably (docs task item 10D — "do NOT attempt to
// squeeze the complete desktop bracket tree into the remaining mobile
// width"), so this stage tab bar + koUi.jsx's MobileKoStageView replace it
// with ONE stage's genuinely-readable cards at a time. Local tab state,
// same "smallest safe implementation" pattern this page already uses for
// its own top-level `section`/BlockSection's `tab`.
const MobileKoStageNav = ({ stage, onChange }) => (
  <div className="mb-3 grid grid-cols-4 gap-1 lg:hidden">
    {KO_MOBILE_STAGE_TABS.map((s) => (
      <button
        key={s.id}
        type="button"
        onClick={() => onChange(s.id)}
        className={`min-w-0 truncate rounded border px-0.5 py-2 text-center font-condensed text-[11px] font-bold uppercase tracking-normal transition ${
          stage === s.id
            ? 'border-canaletto-gold bg-canaletto-gold text-black'
            : 'border-canaletto-border text-canaletto-lavender hover:text-canaletto-cream'
        }`}
      >
        {s.label}
      </button>
    ))}
  </div>
);

// TOP16 — bracket only (director correction pass item 10): no calibration
// table, no director match cards, no danger zone, no score-control UI.
// Reuses koUi.jsx's BracketOverview directly — the SAME projection-driven
// bracket the director app's Top16 page and the full-screen bracket overlay
// render, showing Top16/QF/SF/Final with progressive population as each
// stage is generated. Below `lg`, MobileKoStageNav + koUi.jsx's
// MobileKoStageView replace it with the SAME projection, one stage at a
// time (docs task item 10D) — desktop's BracketOverview is otherwise
// completely unchanged (docs task item 16 — "do not redesign the desktop
// application").
const Top16Section = ({ event }) => {
  const status = getTop16Status(event);
  const projection = getBracketProjection(event);
  const gbrConfig = event.blockA.tournament.config;
  // Reuses the SAME authoritative champion derivation the director's
  // Top16Page.jsx uses (getKoChampion() only ever reads event.ko.final,
  // already whitelisted into publicState as-is — see
  // canalettoPublicState.js) — never a second/looser "close enough" check.
  // getKoChampion() returns null until event.ko.final's matches are ALL
  // match.done, so an unfinished Final's live draft (however close to the
  // race target) can never produce a champion here, exactly like the
  // director page.
  const champion = getKoChampion(event);
  const [mobileStage, setMobileStage] = useState('top16');

  return (
    <div>
      <PageHeader eyebrow="Knockout" title="Top 16" right={<StatusBadge status={status} />} />
      <ChampionBanner champion={champion} />

      <MobileKoStageNav stage={mobileStage} onChange={setMobileStage} />
      <div className="lg:hidden">
        <MobileKoStageView projection={projection} ko={event.ko} schedule={event.schedule} gbrConfig={gbrConfig} liveDraftScores={event.liveDraftScores} stage={mobileStage} />
      </div>

      <div className="hidden lg:block">
        <BracketOverview projection={projection} ko={event.ko} schedule={event.schedule} gbrConfig={gbrConfig} liveDraftScores={event.liveDraftScores} />
      </div>
    </div>
  );
};

// Shown while the cloud has never been published to yet (fresh-empty-
// tournament hotfix, item 9) — `event === EMPTY_PUBLIC_STATE` is the exact
// same fallback reference useCloudPublicEvent() returns before its first
// real snapshot arrives. A meaningful "not live yet" message, never a
// blank/white page.
const NotLiveYet = () => (
  <div className="flex min-h-screen items-center justify-center bg-canaletto-bg text-canaletto-lavender">
    <div className="text-center">
      <div className="mb-2 font-condensed text-2xl font-black uppercase tracking-wide text-canaletto-cream">Tournament Not Live Yet</div>
      <div className="text-sm">Waiting for the tournament director to publish live data.</div>
    </div>
  </div>
);

export const LivescorePage = () => {
  const event = useCloudPublicEvent();
  const [section, setSection] = useState('players');

  if (event === EMPTY_PUBLIC_STATE) return <NotLiveYet />;

  // Fixed-sidebar scroll model (docs task item 10A), at EVERY viewport
  // size: the outer row is pinned to the viewport height and never itself
  // scrolls (`h-dvh overflow-hidden`) — `dvh` rather than `vh` so mobile
  // browser chrome showing/hiding never clips or reflows the sidebar (docs
  // task item 10F). PublicSidebar is a plain flex child (no sticky/fixed
  // positioning needed — see its own comment) that therefore never moves.
  // ONLY `<main>` scrolls (`overflow-y-auto`); `min-w-0` stops its content
  // (grids/tables) from ever forcing the row wider than the viewport (docs
  // task item 13/14 — "no page-level horizontal overflow").
  return (
    <div className="flex h-dvh overflow-hidden bg-canaletto-bg text-canaletto-cream">
      <PublicSidebar event={event} section={section} onNavigate={setSection} />
      <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        {section === 'players' && <PlayersSection event={event} />}
        {section === 'blockA' && <BlockSection event={event} block="A" />}
        {section === 'blockB' && <BlockSection event={event} block="B" />}
        {section === 'top16' && <Top16Section event={event} />}
      </main>
    </div>
  );
};
