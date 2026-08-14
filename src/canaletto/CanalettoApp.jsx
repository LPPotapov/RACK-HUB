import { useState } from 'react';
import { Sidebar } from './Sidebar.jsx';
import { useCanalettoEvent } from './useCanalettoEvent.js';
import { EventPage } from './pages/EventPage.jsx';
import { PlayersPage } from './pages/PlayersPage.jsx';
import { BlockPage } from './pages/BlockPage.jsx';
import { Top16Page } from './pages/Top16Page.jsx';
import { LivePage } from './pages/LivePage.jsx';

function CanalettoApp() {
  const { event, run, error, clearError } = useCanalettoEvent();
  const [page, setPage] = useState('event');

  return (
    <div className="flex min-h-screen min-w-[1180px] bg-canaletto-bg text-canaletto-cream">
      <Sidebar event={event} page={page} onNavigate={setPage} />
      <main className="flex-1 px-8 py-6">
        {error && (
          <div className="mb-4 flex items-center justify-between rounded border border-canaletto-magenta/60 bg-canaletto-magenta/10 px-4 py-2 text-sm font-semibold text-canaletto-magenta">
            <span>{error}</span>
            <button type="button" onClick={clearError} className="font-bold uppercase">Dismiss</button>
          </div>
        )}
        {page === 'event' && <EventPage event={event} run={run} onNavigate={setPage} />}
        {page === 'players' && <PlayersPage event={event} run={run} onNavigate={setPage} />}
        {page === 'blockA' && <BlockPage event={event} run={run} block="A" />}
        {page === 'blockB' && <BlockPage event={event} run={run} block="B" />}
        {page === 'top16' && <Top16Page event={event} run={run} />}
        {page === 'live' && <LivePage event={event} />}
      </main>
    </div>
  );
}

export default CanalettoApp;
