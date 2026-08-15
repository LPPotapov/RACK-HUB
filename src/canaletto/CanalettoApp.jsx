import { useState } from 'react';
import { Sidebar } from './Sidebar.jsx';
import { useCanalettoEvent } from './useCanalettoEvent.js';
import { useCanalettoLiveState } from './useCanalettoLiveState.js';
import { useCanalettoCloudMirror } from './useCanalettoCloudMirror.js';
import { EventPage } from './pages/EventPage.jsx';
import { PlayersPage } from './pages/PlayersPage.jsx';
import { BlockPage } from './pages/BlockPage.jsx';
import { Top16Page } from './pages/Top16Page.jsx';
import { LivePage } from './pages/LivePage.jsx';

function CanalettoApp() {
  const { event, run, error, clearError } = useCanalettoEvent();
  // LIVE/broadcast state (TV-match pointer + tvScores +, since the
  // livescore hotfix, liveDraftScores) — ONE shared instance for the whole
  // app, lifted here rather than instantiated separately per page. Two
  // independent useCanalettoLiveState() instances in the same tab would
  // each read/write the same localStorage key without seeing each other's
  // writes (the cross-tab `storage` event never fires for a tab's own
  // writes), so BlockPage/Top16Page (score-entry, publish drafts) and
  // LivePage (TV-match selection) must share this one instance.
  const { liveState, run: liveRun } = useCanalettoLiveState();
  // Additive: mirrors `event` to/from Firebase while signed in as an
  // authorized director; a pure local no-op otherwise (signed out, or
  // Firebase not configured) — see useCanalettoCloudMirror.js. `liveState`
  // is passed through so its `liveDraftScores` (only) rides along on every
  // publicState write (livescore hotfix).
  const cloudAuth = useCanalettoCloudMirror(event, run, liveState);
  const [page, setPage] = useState('event');

  return (
    <div className="flex min-h-screen min-w-[1180px] bg-canaletto-bg text-canaletto-cream">
      <Sidebar event={event} page={page} onNavigate={setPage} cloudAuth={cloudAuth} />
      <main className="flex-1 px-8 py-6">
        {error && (
          <div className="mb-4 flex items-center justify-between rounded border border-canaletto-magenta/60 bg-canaletto-magenta/10 px-4 py-2 text-sm font-semibold text-canaletto-magenta">
            <span>{error}</span>
            <button type="button" onClick={clearError} className="font-bold uppercase">Dismiss</button>
          </div>
        )}
        {page === 'event' && <EventPage event={event} run={run} onNavigate={setPage} cloudAuth={cloudAuth} />}
        {page === 'players' && <PlayersPage event={event} run={run} onNavigate={setPage} />}
        {page === 'blockA' && <BlockPage event={event} run={run} block="A" liveRun={liveRun} />}
        {page === 'blockB' && <BlockPage event={event} run={run} block="B" liveRun={liveRun} />}
        {page === 'top16' && <Top16Page event={event} run={run} liveState={liveState} liveRun={liveRun} />}
        {page === 'live' && <LivePage event={event} liveState={liveState} run={liveRun} />}
      </main>
    </div>
  );
}

export default CanalettoApp;
