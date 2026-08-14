// Full-screen/widescreen Block Results OBS overlay (LIVE milestone) —
// read-only, reuses getBlockResultsRows() + the shared TwoColumnStandings
// (same underlying StandingsTable/qualification-highlight logic as the
// director app's Block Results tab).

import { getBlockResultsRows } from '../../application/canalettoEvent.js';
import { OverlayHeader, OverlayShell, TwoColumnStandings } from './liveComponents.jsx';
import { useCanalettoEventReadOnly } from './useCanalettoEventReadOnly.js';

export const BlockResultsOverlayPage = ({ block }) => {
  const event = useCanalettoEventReadOnly();
  const rows = getBlockResultsRows(event, block);

  return (
    <OverlayShell maxWidth="max-w-[1400px]">
      <OverlayHeader eyebrow={event.settings.title} title={`Block ${block} — Results`} />
      <TwoColumnStandings rows={rows} qualificationThreshold={event.settings.qualificationThreshold} />
    </OverlayShell>
  );
};
