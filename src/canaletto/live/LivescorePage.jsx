// Firebase-backed Livescore page (LIVE/public correction pass, later split
// for archive isolation) — owns the live publicState subscription and
// hands the result to LivescorePresentation.jsx, which has ZERO Firebase
// awareness. This file is the ONLY place in the live/public module graph
// allowed to import useCloudPublicEvent.js — keeping that import out of
// LivescorePresentation.jsx is what lets CanalettoArchive2026Page.jsx
// import the presentation directly with a bundled JSON snapshot and never
// pull Firebase's module graph in at all (see that module's own header,
// and tests/canaletto-public-domain-routing.test.js's dependency-scan
// test).
import { LivescorePresentation } from './LivescorePresentation.jsx';
import { EMPTY_PUBLIC_STATE, useCloudPublicEvent } from './useCloudPublicEvent.js';

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

  if (event === EMPTY_PUBLIC_STATE) return <NotLiveYet />;

  return <LivescorePresentation event={event} />;
};
