// Full-screen/widescreen Top16 bracket OBS overlay (LIVE milestone) —
// read-only, reuses koUi.jsx's BracketOverview directly (the SAME
// projection-driven bracket the director app's Top16 page renders) — no
// second bracket-rendering implementation.

import { getBracketProjection } from '../../application/canalettoEvent.js';
import { BracketOverview } from '../koUi.jsx';
import { OverlayHeader, OverlayShell } from './liveComponents.jsx';
import { useCanalettoEventReadOnly } from './useCanalettoEventReadOnly.js';

export const BracketOverlayPage = () => {
  const event = useCanalettoEventReadOnly();
  const projection = getBracketProjection(event);
  const gbrConfig = event.blockA.tournament.config;

  return (
    <OverlayShell maxWidth="max-w-[1600px]">
      <OverlayHeader eyebrow={event.settings.title} title="Knockout Bracket" />
      <BracketOverview projection={projection} ko={event.ko} schedule={event.schedule} gbrConfig={gbrConfig} />
    </OverlayShell>
  );
};
