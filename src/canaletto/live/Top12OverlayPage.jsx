// Top 12 current-block broadcast overlay (LIVE milestone) — right-side OBS
// overlay format, read-only. Reuses ui.jsx's StandingsTable directly (the
// SAME component/qualification-highlight logic Block Results already
// uses), sliced to the top 12 — "Highlight the qualifying top 8 the same
// way the Results table does" falls out for free from that reuse, not a
// second highlight implementation.
//
// LIVE/OBS correction pass: Perf restored (size="large" keeps the Perf
// column, unlike the public Players page's `compact` StandingsTable) and
// the whole panel scaled up ~20% for stream readability — panel width,
// padding, logo, header and table type all bumped one notch together, with
// NO forced `min-w` on the table (size="large" sizes itself to the panel,
// same "never a horizontal scrollbar" guarantee as before).

import { getBlockStandings } from '../../application/canalettoEvent.js';
import { StandingsTable } from '../ui.jsx';
import { LiveBrandMark } from './liveComponents.jsx';
import { useCanalettoEventReadOnly } from './useCanalettoEventReadOnly.js';

export const Top12OverlayPage = ({ block }) => {
  const event = useCanalettoEventReadOnly();
  const standings = getBlockStandings(event, block).slice(0, 12);

  return (
    <div className="flex min-h-screen items-start justify-end bg-transparent p-6">
      <div className="w-[560px] rounded-lg border border-canaletto-gold/50 bg-canaletto-panel/95 p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2.5">
          <LiveBrandMark className="h-11 w-11" />
          <div className="font-condensed text-2xl font-black uppercase tracking-tight text-canaletto-cream">Block {block} — Top 12</div>
        </div>
        <StandingsTable players={standings} qualificationThreshold={event.settings.qualificationThreshold} size="large" />
      </div>
    </div>
  );
};
