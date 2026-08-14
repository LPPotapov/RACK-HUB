// Director-side LIVE hub (LIVE milestone) — select the TV match and manage
// the list of public/OBS overlay links. Writes the SAME shared
// canalettoLive.js TV-match pointer the streaming staff's TV Overlay Score
// Control page can also write (streaming-staff correction pass — staff
// switch cameras/tables themselves without waiting for the director);
// every OTHER public/overlay page under src/canaletto/live/ only ever reads
// it. Selecting/clearing a TV match never touches `event` (the
// authoritative CanalettoEvent) at all — this page reads `event` only to
// list which current Block/KO matches exist to choose from (via
// getTvSelectableMatches()).

import { useState } from 'react';
import {
  clearTvMatch,
  getTvSelectableMatches,
  isSelectedTvRow,
  PREFERRED_TV_TABLE_LABEL,
  selectTvMatch
} from '../../application/canalettoLive.js';
import { buildLiveUrl, LIVE_LINKS } from '../live/liveLinks.js';
import { useCanalettoLiveState } from '../useCanalettoLiveState.js';
import { ActionButton, PageHeader, Panel } from '../ui.jsx';

// One key per row, works for both Block ({source,block,roundNumber,matchId})
// and KO ({source,stage,matchNumber}) rows.
const rowKey = (r) => (r.source === 'ko' ? `ko-${r.stage}-${r.matchNumber}` : `block-${r.block}-${r.roundNumber}-${r.matchId}`);

const TvMatchSelector = ({ event }) => {
  const { liveState, run } = useCanalettoLiveState();
  const rows = getTvSelectableMatches(event);
  const selected = liveState.tvMatch;

  return (
    <Panel title="TV Match" accent="magenta">
      <div className="mb-3 text-xs text-canaletto-lavender">
        Choose which current match (Block A/B's current round, or any generated KO match) the TV overlay currently shows. The overlay score is independent of official results — adjust it on the TV Overlay Score Control page (link below), not here. Matches on table <span className="font-semibold text-canaletto-cream">"{PREFERRED_TV_TABLE_LABEL}"</span> are flagged below for quick identification, but any current match may be selected.
      </div>
      {rows.length === 0 && <div className="text-canaletto-lavender">No current Block or KO matches yet.</div>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((r) => {
          const isSelected = isSelectedTvRow(selected, r);
          return (
            <button
              key={rowKey(r)}
              type="button"
              onClick={() => run(selectTvMatch, r)}
              className={`rounded border p-2 text-left transition ${
                isSelected ? 'border-canaletto-gold bg-canaletto-gold/10' : r.isPreferredTable ? 'border-canaletto-magenta/60 bg-canaletto-panel2' : 'border-canaletto-border bg-canaletto-panel2 hover:border-canaletto-lavender'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-condensed text-[10px] font-bold uppercase tracking-wide text-canaletto-lavender">
                  {r.sourceLabel}{r.source === 'ko' ? ` · M${r.matchNumber}` : ''}
                </span>
                {r.isPreferredTable && (
                  <span className="shrink-0 rounded bg-canaletto-magenta/20 px-1 font-condensed text-[9px] font-bold uppercase tracking-wide text-canaletto-magenta">
                    {PREFERRED_TV_TABLE_LABEL}
                  </span>
                )}
              </div>
              <div className="truncate text-sm font-semibold text-canaletto-cream">{r.p1Name} vs {r.p2Name}</div>
              <div className="mt-0.5 text-[10px] text-canaletto-lavender">{r.tbl || 'No table assigned'}</div>
              {isSelected && <div className="mt-1 font-condensed text-[10px] font-bold uppercase tracking-wide text-canaletto-gold">Current TV Match</div>}
            </button>
          );
        })}
      </div>
      {selected && (
        <div className="mt-3">
          <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={() => run(clearTvMatch)}>
            Clear TV Match
          </ActionButton>
        </div>
      )}
    </Panel>
  );
};

const LinkRow = ({ label, query }) => {
  const url = buildLiveUrl(window.location.origin, window.location.pathname, query);
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-canaletto-border bg-canaletto-panel2 px-3 py-2">
      <div className="min-w-0">
        <div className="font-condensed text-sm font-bold uppercase tracking-wide text-canaletto-cream">{label}</div>
        <div className="truncate text-xs text-canaletto-lavender">{url}</div>
      </div>
      <div className="flex shrink-0 gap-2">
        <ActionButton variant="outline" className="px-3 py-1 text-xs" onClick={() => window.open(url, '_blank', 'noopener')}>
          Open
        </ActionButton>
        <ActionButton
          variant="outline"
          className="px-3 py-1 text-xs"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied!' : 'Copy Link'}
        </ActionButton>
      </div>
    </div>
  );
};

export const LivePage = ({ event }) => (
  <div>
    <PageHeader eyebrow="Broadcast" title="Live" subtitle="Public livescore, TV overlay control, and OBS overlay links" />

    <TvMatchSelector event={event} />

    <Panel title="Public & Overlay Links" className="mt-4">
      <div className="mb-3 text-xs text-canaletto-lavender">
        Stable local links — open directly, or copy for OBS Browser Source / sharing. All pages are read-only except TV Overlay Score Control, which only affects the broadcast score, never official results.
      </div>
      <div className="space-y-2">
        {LIVE_LINKS.map((l) => (
          <LinkRow key={l.key} label={l.label} query={l.query} />
        ))}
      </div>
    </Panel>
  </div>
);
